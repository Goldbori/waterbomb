## 목표

확인자 1명이 폰으로 3~5초 안에 판매를 기록할 수 있는 모바일 판매 입력 앱 + 실시간 대시보드. 데이터는 Lovable Cloud(Postgres)에 저장하고, Google Sheets 동기화는 추후.

## 기술 스택 / 저장소

- 프론트: TanStack Start (모바일 우선 레이아웃, Tailwind, shadcn 버튼/카드/토스트).
- 백엔드: Lovable Cloud (자동 프로비저닝) — `sales`, `inventory`, `session_settings` 테이블.
- 인증: 없음. 확인자 전용 폰에서만 사용. 공개 접근 정책 사용 (URL 아는 사람만 사용).

## 데이터 모델 (Lovable Cloud 마이그레이션)

- `inventory(sku text pk, name text, initial_qty int, sold int default 0)`
  초기 시드: `towel_orange(40)`, `towel_mint(40)`, `towel_green(40)`, `hipsack(50)`.
- `sales(id uuid pk, created_at timestamptz default now(), bundle text, items jsonb, price int, age_group text, gender text, group_type text, headcount text, foreign_flag bool, upsell bool, weather text, client_id text unique)`
  - `bundle`: `towel1|towel2|towel3|hipsack`
  - `items`: 타월 번들일 때 색상 배열 예: `["orange","mint"]`
  - `client_id`: 오프라인 큐 재전송 중복 방지용 클라이언트 발급 UUID (unique).
- `session_settings(id int pk default 1, weather text, updated_at timestamptz)` — 단일 행.
- 재고 차감은 `insert_sale` RPC(SECURITY DEFINER)에서 트랜잭션으로: 재고 확인 → sales insert → inventory.sold 증가. 재고 부족 시 에러.
- GRANT + RLS: `anon`/`authenticated` 모두 select/insert 허용 (인증 없는 단일 기기 운영).

## 화면 흐름 (모바일 세로, 큰 탭 타깃)

### 1) 세션 시작 (최초 1회, 이후 상단 배지에서 변경)
날씨 3버튼: 맑음 / 흐림 / 비 → `session_settings`에 저장, localStorage에도 캐시.

### 2) 판매 입력 (메인 화면, 단일 스크린)
상단: 오늘 매출 / 판매수 / 날씨 배지(탭하면 변경).

**Step A — 품목**  4개 큰 버튼:
- 스포츠타월 1개 (6,000)
- 스포츠타월 2개 (11,000)
- 스포츠타월 3개 (15,000)
- 방수힙색 (5,000)

타월 선택 시 → **색상 서브시트** 자동 오픈: 오렌지 / 민트 / 그린 각 개수만큼 탭 (1개는 1탭, 2개는 2탭, 3개는 3탭; 남은 재고 0인 색상은 비활성). 완료되면 다음 스텝으로 자동 진행.

**Step B — 고객 정보** (한 화면에 6개 그리드, 매번 초기화)
- 연령대: 10 / 20 / 30 / 40+
- 성별: 남 / 여 / 혼합
- 구성: 혼자 / 커플 / 친구 / 가족
- 인원수: 1 / 2 / 3 / 4+
- 외국인: 내국인 / 외국인 포함
- 업셀: 예 / 아니오

각 그룹 모두 선택 시 하단 **저장** 버튼 활성. (원탭 저장을 위해 그룹 선택 시 시각적 피드백만, 자동 진행 X — 오탭 방지)

**Step C — 저장**  
`client_id` UUID 발급 → `insert_sale` RPC 호출 → 성공 시 토스트 + Step A로 리셋. 실패(네트워크) 시 IndexedDB 큐에 push.

### 3) 대시보드 (하단 탭 or 상단 링크)
- 총 매출 / 총 판매 수 (오늘)
- 품목별 판매수 + 남은 재고 (타월은 색상별)
- 재고 10개 이하: 빨간 경고 배지
- 시간대별 판매 추이: 시간(hour)별 count 바 차트 (recharts BarChart)
- 실시간 갱신: supabase realtime 구독 or 15초 폴링

## 오프라인 큐

- 저장 시 항상 로컬 IndexedDB(`offline_sales`)에 먼저 push → 즉시 UI 반영(낙관적) → 백그라운드로 서버 전송.
- 전송 성공 시 큐에서 제거. 실패 시 재시도.
- `navigator.onLine` + `online` 이벤트로 재개. `client_id` unique로 중복 삽입 방지.
- 헤더에 대기 중 큐 개수 배지 표시.

## 라우트

- `/` — 판매 입력 (기본)
- `/dashboard` — 대시보드
- `/setup` — 최초 날씨 설정 (미설정 시 `/`에서 자동 모달)

## 향후 (이번 범위 아님)

- Google Sheets 미러링: pg_net으로 Apps Script 웹앱에 POST 하는 트리거/Edge fn 추가 예정.

## 완료 기준

- 폰(375px)에서 A→B→저장이 엄지만으로 3~5초.
- 재고 부족 시 색상 버튼 비활성 + 저장 차단.
- 오프라인에서 저장 가능, 온라인 복귀 시 자동 동기화.
- 대시보드에 매출/판매수/재고/경고/시간대 바 모두 실시간.
