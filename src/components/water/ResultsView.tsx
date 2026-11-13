/**
 * Water & Energy results. Plain module on purpose: the number helpers stay callable from server
 * components (GraceCard, the public example), while the chip and the results view are client
 * components so their text follows the reader's language.
 */
export { ClassChip } from "./ClassChip";
export { monthLabel, num, rangeText } from "./format";
export { ResultsView } from "./ResultsBody";
