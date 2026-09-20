/** The Khronos validator ships without types; this covers the part the tests use. */
declare module 'gltf-validator' {
  export interface ValidationReport {
    issues: {
      numErrors: number;
      numWarnings: number;
      messages: { code: string; pointer: string; severity: number; message: string }[];
    };
  }
  export function validateBytes(
    data: Uint8Array,
    options?: { maxIssues?: number },
  ): Promise<ValidationReport>;
}
