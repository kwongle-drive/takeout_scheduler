const { isMainThread, Worker, parentPort, workerData } = require('worker_threads');
const os = require('os')
const archiver = require('archiver');
const path = require('path');
var fs = require('fs');
const { readdir, lstat, stat, access, mkdir } = require('fs').promises
require("dotenv").config();

const numOfCores = os.cpus.length; //global variables for Main Thread
let curTaskIndex = 0; //현재 처리중인 작업의 인덱스
const takeoutResultPath = [];

//사용자의 Path를 모두 탐색해 모든 파일과 해당 파일들의 사이즈를 가져온다
let files = []; //사용자의 모든 파일 경로와 해당 파일의 용량
let dirs = []; //사용자의 디렉토리 구조
const deepReadDir = async (dirPath, userPath) => {
    await Promise.all(
        (await readdir(dirPath)).map(async (entity) => {
            let target = {}
            target.path = path.join(dirPath, entity)
            if ((await lstat(target.path)).isDirectory()) {
                dirs.push(path.relative(userPath, target.path));
                return await deepReadDir(target.path, userPath);
            } else {
                let statResult = await stat(target.path);
                target.size = statResult.size;
                files.push(target);
                return target;
            }
        }),
    )
}

//쓰레드가 사용자가 요청한 용량씩 작업할 수 있도록 파일들을 배열로 나누는 함수
function filesSeperateWithSize(filesBySize, capacity) {
    let totSize = 0;
    let store = [];
    for (let i = 0; i < files.length; i++) {
        let newSize = totSize + files[i].size;
        if (newSize > capacity * 1000_000_000) {
            filesBySize.push(store);
            totSize = files[i].size;
            store = [files[i].path];
        } else {
            store.push(files[i].path);
            totSize = newSize;
        }
    }
    filesBySize.push(store);
}

//메인 쓰레드 작업
async function main(tasks) {
    if (isMainThread) {
        const threads = new Set();
        const curTask = tasks[curTaskIndex];
        const userPath = path.join(process.env.DRIVE_PATH, curTask.path);
        const {id, userId} = curTask;
        takeoutResultPath.length = 0;
        files = [];
        dirs = [];

        //고객 드라이브 탐색
        await deepReadDir(userPath, userPath);

        //쓰레드당 수행할 테스크 분리
        let filesBySize = [];
        filesSeperateWithSize(filesBySize, curTask.capacity)

        //테이크 아웃 용량으로 나눈 작업 개수만큼 쓰레드 생성
        let threadId = 1;
        for (let i = 0; i < filesBySize.length; i++) {
            threads.add(new Worker(__filename, {
                workerData: { userPath, dirs, files: filesBySize[i], threadId , takeOutId : id, userId} //초기 데이터를 넣어줄 수 있다.
            }));
            threadId++;
        }

        //쓰레드 종료 대기
        for (let worker of threads) {

            worker.on('message', (value) => { //worker가 작업을 마치고 생성된 zipfilename을 전송한 것을 수신함
                takeoutResultPath.push({path :value.zipFileName, size : value.size});
            });

            worker.on('exit', () => {
                threads.delete(worker);
                if (threads.size === 0) {
                    console.log(curTaskIndex,"번 작업이 끝났음")
                    process.send({
                        taskout_queue_id: curTask.id,
                        success: true,
                        message: `${curTask.id} 작업이 완료되었습니다`,
                        takeoutResultPath
                    });
                    if(++curTaskIndex == tasks.length){
                        process.send({
                            success: true,
                            finish: true,
                            message: "전체 작업이 잘 끝났음"
                        });
                    }else{
                        // process.send({
                        //     taskout_queue_id: curTask.id,
                        //     success: true,
                        //     message: `${curTask.id} 작업이 완료되었습니다`,
                        //     takeoutResultPath
                        // });
                        main(tasks);
                    }
                }
            })
        }
    }
}


//워커 쓰레드
if (!isMainThread) {
    worker();
}
async function worker(){
    const { files, dirs, threadId, userPath, takeOutId, userId } = workerData;
   
    //해당 사용자의 takeout경로가 존재하는 지 확인후 없으면 경로 생성
    const userTakeOutPath =path.join(process.env.TAKEOUT_PATH,userId.toString());
    try {
        await access(userTakeOutPath, fs.constants.F_OK);
    } catch (err){
        await mkdir(userTakeOutPath);
    }

    //writable steram 생성
    const zipFileName = `takeout-${Date.now()}-${takeOutId}-${threadId}.zip`;
    var output = fs.createWriteStream(path.join(userTakeOutPath,`${zipFileName}`));

    var archive = archiver('zip', {
        gzip: true,
        zlib: { level: 9 } // Sets the compression level.
    });

    //archive zip stream interface와 output 연결
    archive.pipe(output);

    //zip에 폴더 뼈대 생성
    dirs.forEach(dir => {
        archive.file(".", { name: path.join(dir, '/') });
    })

    //zip에 파일 저장
    files.forEach(dir => {
        const relativePath = path.relative(userPath, dir);
        archive.file(dir, { name: relativePath });
    })

    archive.finalize();

    output.on('close', function () {
        // console.log(archive.pointer() + ' total bytes');
        // console.log('archiver has been finalized and the output file descriptor has closed.');
        parentPort.postMessage({ 
                zipFileName,
                size: archive.pointer() 
        });
        console.log("TASK INDEX : " + curTaskIndex + " [" + threadId +"]번 쓰레드 작업 종료");
    });

    archive.on('error', function (err) {
        throw err;
    });

}


//이벤트 리스너
process.on('message', async (m) => {
    console.log(m);
    if (m.tasks.length == 0) {
        process.send({
            success: true,
            finish: true,
            message: "수행할 테스크가 0개 입니다. 다시 보내주세요"
        });
    }else{
        console.log("takeout 태스크 메인 프로세스에서 수신",m.tasks);
        curTaskIndex = 0;
        await main(m.tasks);
    }
})