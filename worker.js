const { isMainThread, Worker, parentPort, workerData } = require('worker_threads');
const os = require('os')
const archiver = require('archiver');
const path = require('path')
const { readdir, lstat, stat } = require('fs').promises
require("dotenv").config();

//global variables for Main Thread
const numOfCores = os.cpus.length;
let curTaskIndex = 0;

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

async function main(tasks) {
    if (isMainThread) {
        const threads = new Set();
        const curTask = tasks[curTaskIndex];
        const userPath = path.join(process.env.DRIVE_PATH, curTask.path);
        files = [];
        dirs = [];
        await deepReadDir(userPath, userPath);
        //쓰레드당 수행할 테스크 분리
        let filesBySize = [];
        filesSeperateWithSize(filesBySize, curTask.capacity)

        //테이크 아웃 용량으로 나눈 작업 개수만큼 쓰레드 생성
        let threadId = 1;
        for (let i = 0; i < filesBySize.length; i++) {
            threads.add(new Worker(__filename, {
                workerData: { userPath , files: filesBySize[i], threadId } //초기 데이터를 넣어줄 수 있다.
            }));
            threadId++;
        }

        for (let worker of threads) {
            worker.on('message', (value) => console.log('워커로부터', value));
            worker.on('exit', () => {
                threads.delete(worker);
                if (threads.size === 0) {
                    console.log("워커 끝")
                    process.send({
                        success: true,
                        message: "작업이 잘 끝났음"
                    });
                }
            })
        }
    }
}

//워커 쓰레드
if (!isMainThread) {
    var zip = new AdmZip();
    const {files ,dirs, threadId , userPath} = workerData;
    files.forEach(dir => {
        const relativePath =path.relative(userPath, dir);
        zip.addLocalFile(dir, path.join(relativePath, '../'));
    })

    
    zip.writeZip(/*target file name*/ `./${threadId}.zip`);
    zip.addFile()
    output.on('close', function() {
        console.log(archive.pointer() + ' total bytes');
        // console.log('archiver has been finalized and the output file descriptor has closed.');
        console.log(threadId,"번 쓰레드 작업 종료");
      });
      
}


//이벤트 리스너
process.on('message', async (m) => {
    curTaskIndex = 0;
    // console.log(m);
    if (m.tasks.length == 0) {
        process.send({
            success: true,
            message: "수행할 테스크가 0개 입니다. 다시 보내주세요"
        });
    }
    await main(m.tasks);
})