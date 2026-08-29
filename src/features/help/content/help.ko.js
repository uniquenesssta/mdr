/**
 * Responsibility: Immutable long-form Help content and Help-specific labels for ko.
 * Imports: None; short-text i18n dictionaries and runtime services are forbidden here.
 * Exports: One frozen locale content record.
 * State/side effects: None. Lifecycle: import-only data module.
 */
const titles = Object.freeze({
  "start": "빠른 시작",
  "views": "보기 및 탐색",
  "files": "파일 및 내보내기",
  "shortcuts": "단축키",
  "markdown": "Markdown 기능",
  "about": "정보"
});
const summaries = Object.freeze({
  "start": "작성과 기본 작업",
  "views": "레이아웃, 사이드바 및 탐색",
  "files": "열기, 저장 및 내보내기",
  "shortcuts": "자주 쓰는 앱 작업",
  "markdown": "이미지, 수식 및 다이어그램",
  "about": "애플리케이션 정보"
});

const content = Object.freeze({
  "locale": "ko",
  "sourceHtml": "<p>이것은 바로 사용할 수 있는 브라우저 Markdown 편집기입니다. 왼쪽에서 작성하면 오른쪽에 실시간으로 미리보기가 표시됩니다. 내용은 브라우저 로컬에 자동 저장되며 다음에 열 때 복원됩니다.</p>\n<p><b>작성 시작</b></p>\n<ul>\n  <li>왼쪽에 Markdown을 입력하면 오른쪽에 실시간으로 렌더링됩니다.</li>\n  <li>도구 모음 버튼으로 제목, 굵게, 목록, 인용, 코드, 링크, 이미지, 표 등을 빠르게 삽입할 수 있습니다.</li>\n  <li>텍스트를 선택한 뒤 서식 버튼을 클릭하면 선택 영역을 자동으로 감싸거나 바꿉니다.</li>\n</ul>\n<p><b>보기 조정</b></p>\n<ul>\n  <li>가운데 구분선을 드래그하여 좌우 너비 조절; 헤더의「⟨」/「⟩」버튼으로 영역 접기/펼치기.</li>\n  <li>도구 모음「보기」에서「편집 + 미리보기 / 편집만 / 미리보기만」전환.</li>\n  <li>오른쪽 상단의「소스」탭에서 Markdown 소스를 직접 수정하고「미리보기」로 돌아가 확인.</li>\n</ul>\n<p><b>저장, 가져오기 및 내보내기</b></p>\n<ul>\n  <li><code>Ctrl+S</code> 또는 💾 저장 클릭; 자동 저장은 설정한 간격으로 실행됩니다.</li>\n  <li>⬆ 가져오기로 로컬 .md / .txt를 열거나 파일을 창으로 드래그하세요.</li>\n  <li>⬇ 내보내기로 Markdown, HTML, Word, PDF(PDF로 저장), 이미지 출력.</li>\n</ul>\n<p><b>이미지와 수식</b></p>\n<ul>\n  <li>도구 모음「이미지」는 링크 삽입과 로컬 업로드를 지원; 로컬 이미지는 Base64로 문서에 포함되어 오프라인에서도 사용됩니다.</li>\n  <li><code>$...$</code> 인라인 수식과 <code>$$...$$</code> 블록 수식 지원.</li>\n</ul>\n<p><b>Web을 Markdown으로</b></p>\n<ul>\n  <li>🌐을 클릭하고 웹 페이지 링크를 입력하면 본문을 자동으로 추출합니다.</li>\n</ul>\n<p><b>자주 사용하는 단축키</b>: <code>Ctrl+S</code> 저장, <code>Ctrl+Z</code> 실행 취소, <code>Ctrl+Y / Ctrl+Shift+Z</code> 다시 실행, <code>Ctrl+B</code> 굵게, <code>Ctrl+I</code> 기울임, <code>Ctrl+U</code> 밑줄, <code>Ctrl+K</code> 링크, <code>Ctrl+Shift+K</code> 이미지, <code>Ctrl+F</code> 찾기, <code>Ctrl+H</code> 바꾸기, <code>Tab</code> 4칸 들여쓰기.</p>",
  "dialogSummary": "주제별 사용 방법과 자주 쓰는 단축키",
  "closeLabel": "도움말 닫기",
  "navigationLabel": "도움말 분류",
  "aboutHtml": "<div class=\"about-app-card\"><span class=\"about-app-mark\" aria-hidden=\"true\">M</span><div><b>Markdown Editor</b><small>1.0.0</small></div></div><p>Tauri, Rust 및 네이티브 프런트엔드 기술로 구축된 경량 로컬 Markdown 편집기로 오프라인 편집, 실시간 미리보기 및 대용량 문서 가상화를 지원합니다.</p>",
  "titles": titles,
  "summaries": summaries
});

export default content;
