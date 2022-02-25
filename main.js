const path = require('path');
const { fork } = require('child_process');
require("dotenv").config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient()


//WORKER NODE JS PROCESS 생성
const nodefile = path.join(__dirname, 'worker')
const worker = fork(nodefile)

//DATABASE 쿼리 
let limit = 100;
let query = `select tq.id, tq.capacity, tq.expired_at, tq.userId, u.email,d.path from takeout_queue tq
            inner join user u
            on u.id = tq.userId
            inner join drive d
            on d.id = tq.userId
            where tq.finish =
            limit ${limit}
            `;

//쿼리 수행 및 child process에 결과 전송
const start = async () => {
    try{
        const results = await prisma.$queryRaw`select tq.id, tq.capacity, tq.expired_at, tq.userId, u.email,d.path from takeout_queue tq
            inner join user u
            on u.id = tq.userId
            inner join drive d
            on d.id = tq.userId
            limit ${limit}
        `;
        worker.send(
            { tasks: results }
        )
    } catch(err){
        console.log(err);
    }
}



start();

//완료된 작업들 데이터베이스에 저장
const updateTakeoutStatus = async (takeoutId,takeoutResultPath) => {
    await prisma.takeout_queue.update({
        where:{
            id: takeoutId
        },
        data:{
            finish: true
        }
    })
    for(let i = 0 ; i < takeoutResultPath.length ; i++){
        console.log(takeoutResultPath[i])
        await prisma.takeout_result_path.create({
            data:{
                takeoutId,
                path: takeoutResultPath[i].path,
                size: parseFloat((takeoutResultPath[i].size / 1000_000_000).toFixed(2))
            }
        })
    }
}

//event handler
worker.on('message',async (m) => {
    console.log(m);
    if(m.success){
        await updateTakeoutStatus(m.taskout_queue_id, m.takeoutResultPath);
    }
    start();
})


