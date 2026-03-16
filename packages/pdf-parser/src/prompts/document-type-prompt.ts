/** System prompt for document type validation */
export const DOCUMENT_TYPE_SYSTEM_PROMPT = `You are given text extracted from the first and last pages of a PDF document.
Determine if this document is an archaeological investigation report from any country.

Valid types include (in any language):
- Excavation report (발굴조사보고서)
- Trial excavation report (시굴조사보고서)
- Surface survey report (지표조사보고서)
- Detailed excavation report (정밀발굴조사보고서)
- Underwater excavation report (수중발굴조사보고서)
- Salvage excavation report
- Archaeological assessment report
- Any other archaeological fieldwork investigation report

NOT valid (these are NOT archaeological investigation reports):
- Repair/restoration reports (수리보고서)
- Simple measurement reports (단순 실측 보고서)
- Architectural investigation reports (건축조사보고서)
- Academic research reports (학술조사보고서)
- Environmental impact assessments (환경영향평가)
- General academic papers or textbooks about archaeology
- Conservation/preservation reports
- Museum catalogs or exhibition guides`;
