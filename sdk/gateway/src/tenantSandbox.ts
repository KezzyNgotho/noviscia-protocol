import { Sandbox } from './index';

export type ExecutionRecord = { adapter: string; payload: any; ts: number };

export class TenantSandbox extends Sandbox {
  tenantId: string;
  allowedAdapters: string[];
  private executions: ExecutionRecord[] = [];

  constructor(tenantId: string, allowedAdapters: string[] = []) {
    super(tenantId);
    this.tenantId = tenantId;
    this.allowedAdapters = allowedAdapters;
  }

  canAccess(adapterName: string) { return this.allowedAdapters.includes(adapterName); }

  recordExecution(exec: { adapter: string; payload: any }) {
    if (!this.canAccess(exec.adapter)) throw new Error('adapter-not-allowed');
    const r: ExecutionRecord = { adapter: exec.adapter, payload: exec.payload, ts: Date.now() };
    this.executions.push(r);
    this.write('executions', this.executions);
  }

  listExecutions() { return this.executions.slice(); }

  // Simple local balance tracker used for PoC isolation checks
  private balance = 0;
  adjustBalance(delta: number) { this.balance += delta; this.write('balance', this.balance); }
  getBalance() { return this.balance; }
}
