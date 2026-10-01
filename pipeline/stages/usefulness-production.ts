// Owner-promoted configuration. Experiments pass their own combiner to the stage.
// Approval: https://github.com/cwebley/word-well/issues/11#issuecomment-5940925373
import artifact from "../../config/usefulness-combiner-effc8eb93ba0.json" with { type: "json" };
import { loadCombiner } from "./usefulness.js";

export const PRODUCTION_COMBINER = loadCombiner(artifact);
