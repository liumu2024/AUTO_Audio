export type ExternalUrlAccessKind = 'external_https' | 'external_http' | 'empty' | 'invalid' | 'unsupported_protocol' | 'local_host' | 'private_network';
export interface ExternalUrlAccessReport {
    ok: boolean;
    kind: ExternalUrlAccessKind;
    reason: string;
    hostname?: string;
    protocol?: string;
    normalizedUrl?: string;
}
export declare function classifyExternalUrlAccess(value: string | undefined | null): ExternalUrlAccessReport;
export declare function isLikelyExternallyReachableUrl(value: string | undefined | null): boolean;
//# sourceMappingURL=external-url-access.d.ts.map