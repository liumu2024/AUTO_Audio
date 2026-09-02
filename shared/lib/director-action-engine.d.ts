import type { DirectorAction } from '../types/director-action.js';
import type { DirectorContext } from '../types/director-context.js';
import type { DirectorIntentResult } from '../types/director-context.js';
export interface ResolveDirectorActionInput {
    context: DirectorContext;
}
export declare function directorActionFromIntentResult(input: ResolveDirectorActionInput & {
    result: DirectorIntentResult;
}): DirectorAction;
//# sourceMappingURL=director-action-engine.d.ts.map