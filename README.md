# 📋 EV2 TikTok 광고 분석 봇 - 개발 인수인계

## 🎯 프로젝트 개요

| 항목 | 내용 |
|------|------|
| 프로젝트명 | EV2 TikTok Ad Analyzer |
| 봇 번호 | EV2 봇 #3 |
| 목적 | TikTok 키워드 검색 → 인기 콘텐츠 Top 5 정보 수집 |
| 기술 스택 | Node.js + Express + Playwright + PostgreSQL |
| 배포 | Railway (백엔드), Vercel (프론트엔드) |

## 🏗️ 시스템 아키텍처

```
사용자 (브라우저)
    ↓ 키워드 입력 (예: "메디큐브 PDRN")
Vercel (프론트엔드) - /ev2/tiktok
    ↓ POST /api/tiktok/search
Railway (백엔드) - ev2-tiktok-analyzer
    ├── 1. Playwright로 TikTok 검색
    ├── 2. 인기 탭 상위 5개 비디오 카드 수집
    ├── 3. 각 비디오 페이지 방문 → 상세 정보 수집
    ├── 4. PostgreSQL 저장
    └── 5. Telegram 알림
    ↓
결과 반환 → 프론트엔드 표시
```

## 📂 프로젝트 구조

```
ev2-tiktok-analyzer/
├── server.js              # Express 서버
├── package.json           # 의존성
├── Dockerfile             # Railway 배포용
├── .env.example           # 환경변수 템플릿
├── .gitignore
├── routes/
│   └── analyze.js         # API 라우트 (검색, 키워드, 이력)
├── services/
│   ├── scraper.js         # TikTok 스크래퍼 (Playwright)
│   ├── database.js        # PostgreSQL 연결 + 테이블 초기화
│   └── telegram.js        # Telegram 알림
└── README.md
```

## 🔌 API 엔드포인트

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | / | Health Check |
| POST | /api/tiktok/search | 키워드 검색 시작 |
| GET | /api/tiktok/search/:id/status | 검색 상태 조회 |
| GET | /api/tiktok/search/:id | 검색 결과 상세 (비디오 포함) |
| GET | /api/tiktok/searches | 전체 검색 이력 (페이징) |
| GET | /api/tiktok/keywords | 키워드 목록 |
| POST | /api/tiktok/keywords | 키워드 추가 |
| DELETE | /api/tiktok/keywords/:id | 키워드 삭제 |
| DELETE | /api/tiktok/search/:id | 검색 결과 삭제 |

### API 요청/응답 예시

**검색 시작:**
```
POST /api/tiktok/search
Body: { "keyword": "메디큐브 PDRN", "topN": 5 }

Response:
{
  "success": true,
  "searchId": 1,
  "message": "'메디큐브 PDRN' 검색을 시작합니다"
}
```

**검색 결과 조회:**
```
GET /api/tiktok/search/1

Response:
{
  "success": true,
  "data": {
    "search": {
      "id": 1,
      "keyword": "메디큐브 PDRN",
      "status": "completed",
      "video_count": 5,
      "started_at": "2026-02-06T...",
      "completed_at": "2026-02-06T..."
    },
    "videos": [
      {
        "rank": 1,
        "video_url": "https://www.tiktok.com/@user/video/123",
        "creator_id": "chichi_e_u",
        "creator_name": "치치",
        "description": "올리브영 매출 1위 세럼의 충격...",
        "posted_date": "2025-04-03",
        "likes": "2355",
        "comments": "49",
        "bookmarks": "299",
        "shares": "117",
        "views": "N/A"
      }
    ]
  }
}
```

## 🔍 스크래핑 전략

### 검색 흐름
1. `https://www.tiktok.com/search?q=키워드` 로 이동
2. 인기 탭이 기본 선택되므로 바로 결과 수집
3. 비디오 카드에서 URL, 유저 ID 수집
4. 각 비디오 페이지 방문하여 상세 정보 수집

### 데이터 추출 전략 (2단계)
1. **`__UNIVERSAL_DATA_FOR_REHYDRATION__`** JSON 우선 시도 → 가장 정확
2. **DOM 셀렉터** fallback → `data-e2e` 속성 기반

### 주요 셀렉터
```
검색 결과 카드: div[id^="column-item-video-container"]
비디오 링크: a[href*="/video/"]
유저 ID: p[data-e2e="search-card-user-unique-id"]
좋아요: [data-e2e="like-count"]
댓글: [data-e2e="comment-count"]
북마크: [data-e2e="undefined-count"]
공유: [data-e2e="share-count"]
조회수: [data-e2e="video-views"]
```

### 봇 감지 우회
- `navigator.webdriver` 숨기기
- `window.chrome` 객체 추가
- 한국어 로케일/타임존 설정
- 랜덤 딜레이 (1~4초)
- Human-like User-Agent

## 🗃️ 데이터베이스 구조

### tiktok_keywords
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PK | |
| keyword | VARCHAR(200) UNIQUE | 검색 키워드 |
| is_active | BOOLEAN | 활성 여부 |
| schedule_cron | VARCHAR(50) | 정기 실행 크론 (미래) |

### tiktok_searches
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PK | |
| keyword_id | FK → tiktok_keywords | |
| keyword | VARCHAR(200) | 검색어 |
| status | VARCHAR(20) | pending/scraping/completed/failed |
| video_count | INTEGER | 수집 영상 수 |
| error | TEXT | 에러 메시지 |
| started_at | TIMESTAMP | |
| completed_at | TIMESTAMP | |

### tiktok_videos
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | SERIAL PK | |
| search_id | FK → tiktok_searches | |
| rank | INTEGER | 순위 (1~5) |
| video_url | TEXT | TikTok URL |
| creator_id | VARCHAR(200) | @아이디 |
| creator_name | VARCHAR(200) | 닉네임 |
| description | TEXT | 영상 설명 |
| posted_date | VARCHAR(100) | 게시일 |
| likes | VARCHAR(50) | 좋아요 수 |
| comments | VARCHAR(50) | 댓글 수 |
| bookmarks | VARCHAR(50) | 즐겨찾기 수 |
| shares | VARCHAR(50) | 공유 수 |
| views | VARCHAR(50) | 조회수 |

## 🚀 배포 방법

### Railway 배포
```bash
# GitHub 저장소 생성 후
cd ev2-tiktok-analyzer
git init
git add .
git commit -m "Initial: EV2 TikTok Analyzer"
git remote add origin https://github.com/greenwhale777/ev2-tiktok-analyzer.git
git push -u origin main

# Railway에서:
# 1. New Project → Deploy from GitHub repo
# 2. 환경변수 설정 (DATABASE_URL, TELEGRAM_BOT_TOKEN 등)
# 3. 자동 배포 완료
```

### Vercel 프론트엔드
```
ev-dashboard의 Vercel 환경변수에 추가:
NEXT_PUBLIC_TIKTOK_API_URL=https://ev2-tiktok-analyzer-production.up.railway.app
```

### 프론트엔드 파일 복사
```bash
# ev-dashboard 프로젝트에 TikTok 페이지 추가
cp app/ev2/tiktok/page.tsx → C:\Projects\ev-dashboard\app\ev2\tiktok\page.tsx
```

## 🔮 향후 개선 (참고)

- [ ] 키워드별 정기 자동 실행 (cron + schedule_cron 필드)
- [ ] 시계열 트렌드 분석 (같은 키워드 반복 검색 → 순위 변동 추적)
- [ ] 크리에이터 프로필 상세 수집
- [ ] 영상 AI 분석 (Gemini Vision)
- [ ] EV2 메인 페이지 봇 카드 추가
- [ ] 같은 Railway 프로젝트로 PostgreSQL 통합 (Private Network)
