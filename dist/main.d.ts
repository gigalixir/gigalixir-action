export declare function run(): Promise<void>;
export declare function setAppConfig(email: string, apiKey: string, appName: string): Promise<void>;
export declare function waitForDeployment(email: string, apiKey: string, appName: string, sha: string, timeoutSeconds: number): Promise<void>;
