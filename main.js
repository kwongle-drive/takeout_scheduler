const mysql = require('mysql2');  // mysql 모듈 로드
const path = require('path');
const { fork } = require('child_process');
const { timingSafeEqual } = require('crypto');
require("dotenv").config();

const conn = {  // mysql 접속 설정
    host: process.env.DATABASE_HOST,
    user: process.env.DATABASE_ID,
    password: process.env.DATABASE_PASS,
    database: 'kwongledrive'
};


//DB CONNECTION
const connection = mysql.createConnection(conn); // DB 커넥션 생성
connection.connect();   // DB 접속

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
            limit ${limit}
            `;

//쿼리 수행 및 child process에 결과 전송
const start = () => {connection.query(query, (err, results, fields)=>{
        if(err){
            console.log(err);
        }
        worker.send(
            { tasks : results}
        )
    })
}
start();

//event handler
worker.on('message',(m)=>{
    console.log(m);
})


