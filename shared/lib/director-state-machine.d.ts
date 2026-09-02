import type { DirectorSessionSnapshotInput, DirectorSessionState } from '../types/director-state.js';
export declare function createInitialDirectorSessionState(): DirectorSessionState;
export declare function syncDirectorSessionSnapshot(_previous: DirectorSessionState | undefined, input: DirectorSessionSnapshotInput): DirectorSessionState;
export declare function summarizeDirectorSessionState(state?: DirectorSessionState): string;
//# sourceMappingURL=director-state-machine.d.ts.map