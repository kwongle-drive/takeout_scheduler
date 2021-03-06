# takeout_server
[구글의 테이크 아웃](https://takeout.google.com/u/2/)기능을 구현한다.  
사용자의 드라이브를 사용자가 요청한 용량만큼 나눠서 zip파일 생성후 다운로드 링크 제공  

**참고이미지 - 구글 드라이브 테이크 아웃 결과**  
![image](https://user-images.githubusercontent.com/22045187/155680408-7c8341ce-4c02-4000-8036-952ac7515143.png)

## 작동 방식

### 메인 프로세스 
1. 메인 프로세스에서 DB에서 요청된 테이크아웃 요청을 최대 100건을 가져온 후 워커 프로세스에 전송힌다.  
(3초 간격으로 polling 방식으로 요청 건 확인)
3. 워커 프로세스에서 전달 받은 테이크 아웃 요청이 처리완료되었다는 이벤트가 1건씩 올때 마다 DATABASE업데이트를 한다.
4. 워커 프로세스에 전송한 모든 테이크 아웃요청들이 완료되면(1번에서 가져온 최대 100건이 모두 완료) 다시 1번으로 돌아가서 연속 수행한다.

### 워커 프로세스
1. **[메인 쓰레드]** 전송받은 테이크아웃 요청들을 1건씩 처리한다.
2. **[메인 쓰레드]** 수행할 테이크 아웃요청 신청 유저의 드라이브를 탐색하여 처리할 파일들과 드라이브 폴더 구조를 분석한다.
3. **[메인 쓰레드]** 처리할 파일들을 설정한 용량만큼 작업을 나눈후 워커 쓰레드 개수설정 및 생성 후 각 워커 쓰레드에게 힐당 작업을 제공한다.
4. **[워커 쓰레드]** 기본 드라이브 폴더 구조를 ZIP파일에 생성한 후 처리할 파일들을 ZIP파일에 **스트림**방식으로 전송한다.
5. 모든 워커쓰레드가 작업이 완료되면 메인 쓰레드에서 메인 프로세스로 전달되는 처리완료 이벤트 EMIT. -> 메인 프로세스의 2번이 동작
6. 모든 테이크 아웃 요청들(최대 100건)이 완료되면 메인 프로세스에 ALL 처리 완료 이벤트 EMIT. -> 메인 프로세스의 3번이 동작

### 참고 이미지
![Untitled Diagram drawio (1)](https://user-images.githubusercontent.com/22045187/155679262-7dad12aa-037e-4781-8d91-7a7f1ce1c15e.png)


## 적용된 성능 개선 방안
1. thread를 이용하여  작업 시간 단축(cpu core개수에 비례해서 성능 증가) 
2. 데이터베이스에서 미리 N개를 가져와 메모리에 큐로 저장함으로써 데이터베이스에 요청하고 응답받는 시간 최적화
3. main 프로세스가 worker 프로세스에게 작업을 부여할 때 매번 fork()로 만드는게 아니라 fork()는 한번만 하고 메시지를 주고받는 형식(IPC을 채택함으로써 프로세스가 실행되는데 걸리는 비용 절약
4. [Stream](https://benkwon.tistory.com/6)을 이용하여 메모리 최적화

## .env 설정
```
# DRIVE PATH
DRIVE_PATH=C:\Users\userId\...\kwongle_drive_main_server\drives


# TAKEOUT PATH
TAKEOUT_PATH=C:\Users\userId\...t\kwongle_drive_main_server\takeout

# DATABSE
DATABASE_HOST=localhost
DATABASE_ID=root
DATABASE_PASS=root


# This was inserted by `prisma init`:
# Environment variables declared in this file are automatically made available to Prisma.
# See the documentation for more detail: https://pris.ly/d/prisma-schema#accessing-environment-variables-from-the-schema

# Prisma supports the native connection string format for PostgreSQL, MySQL, SQLite, SQL Server, MongoDB (Preview) and CockroachDB (Preview).
# See the documentation for all the connection string options: https://pris.ly/d/connection-strings

DATABASE_URL="mysql://root:root@localhost:3306/kwongledrive"
```
