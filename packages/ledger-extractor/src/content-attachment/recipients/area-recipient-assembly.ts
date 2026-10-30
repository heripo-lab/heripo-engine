import type {
  ContentAttachmentAreaRecipientDecision,
  ContentAttachmentRecipientAttachmentOrigin,
  ContentAttachmentRecipientDecision,
} from './types';

/** Project a schema-validated decision without changing judgments, evidence or uncertainty groups. */
export function assembleContentAttachmentAreaRecipientDecision(
  kinds: ReadonlyMap<string, string>,
  raw: ContentAttachmentAreaRecipientDecision,
): {
  decision: ContentAttachmentRecipientDecision;
  attachmentOrigins: ContentAttachmentRecipientAttachmentOrigin[];
} {
  const areaRefs = [...kinds]
    .filter(([, kind]) => kind === 'area')
    .map(([ref]) => ref);
  if (
    Object.keys(raw.areaAssessments).length !== areaRefs.length ||
    areaRefs.some((ref) => !Object.hasOwn(raw.areaAssessments, ref))
  )
    throw new Error('Area assessment keys differ from the registry');
  const { nonAreaAttachments, ...rest } = structuredClone(raw);
  const attachmentOrigins: ContentAttachmentRecipientAttachmentOrigin[] = [];
  const attachments = nonAreaAttachments.map((attachment, index) => {
    const kind = kinds.get(attachment.candidateRef);
    if (!kind || kind === 'area')
      throw new Error('Non-area attachment has an area or unknown candidate');
    attachmentOrigins.push({
      candidateRef: attachment.candidateRef,
      field: 'nonAreaAttachments',
      index,
    });
    return attachment;
  });
  for (const ref of areaRefs) {
    const assessment = rest.areaAssessments[ref];
    if (assessment.disposition !== 'included') continue;
    const {
      currentWordRanges,
      contextWordRanges,
      candidateEvidenceRefs,
      originRowRefs,
    } = assessment;
    attachments.push({
      candidateRef: ref,
      currentWordRanges,
      contextWordRanges,
      candidateEvidenceRefs,
      originRowRefs,
    });
    attachmentOrigins.push({
      candidateRef: ref,
      field: 'areaAssessments',
      areaRef: ref,
    });
  }
  return { decision: { ...rest, attachments }, attachmentOrigins };
}
