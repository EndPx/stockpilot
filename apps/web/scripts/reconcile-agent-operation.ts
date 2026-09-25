/** Explicit single-operation operator recovery. Dry-run by default. Uses the
 * same evidence and locked state transition as MCP; never signs or sends.
 * Run only with the protected VPS database environment, never a browser token. */
import { controlStore, getControlPool } from "../lib/control-plane/db";
import { reconcileOwnedAgentOperation, type AgentOperationRecord } from "../lib/control-plane/agent-operations";
import { publicAgentOperation, readAgentOperationResolution } from "../lib/agent-execution/gateway";

const [id, mode] = process.argv.slice(2);
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id ?? "") ||
  (mode !== undefined && mode !== "--apply") || process.argv.length > 4) {
  throw new Error("Usage: reconcile-agent-operation.ts <operation UUID> [--apply]");
}
try {
  const result = await controlStore.query<{ operation: AgentOperationRecord }>(`
    SELECT jsonb_build_object('id',id,'accountId',account_id,'clientId',client_id,'walletAddress',wallet_address,
      'clientRequestId',client_request_id,'kind',kind,'amountRaw',amount_raw::text,'assetId',asset_id,'recipient',recipient,
      'intentHash',intent_hash,'policyVersion',policy_version,'status',status,'providerRequestId',provider_request_id,
      'messageFingerprint',message_fingerprint,'transactionSignature',transaction_signature,'preparedContext',prepared_context,
      'actualInputAmountRaw',actual_input_amount_raw::text,'createdAt',created_at,'updatedAt',updated_at,
      'submittedAt',submitted_at,'resolvedAt',resolved_at,'expiresAt',expires_at) AS operation
    FROM control_agent_operations WHERE id=$1`, [id]);
  const operation = result.rows[0]?.operation;
  if (!operation) throw new Error("Operation not found");
  const evidence = await readAgentOperationResolution(operation);
  if (!evidence) {
    console.log(JSON.stringify({ operationId: id, status: operation.status, changed: false, message: "No new terminal evidence. No transaction sent." }));
  } else if (mode !== "--apply") {
    console.log(JSON.stringify({ operationId: id, status: operation.status, proposedStatus: evidence.outcome,
      evidence: evidence.evidence, changed: false, message: "Dry run; no database writes or transaction submission." }));
  } else {
    const resolved = await reconcileOwnedAgentOperation({ privyUserId: operation.accountId, walletAddress: operation.walletAddress },
      operation.clientId, id, evidence);
    console.log(JSON.stringify({ ...publicAgentOperation(resolved), changed: true, message: "Reconciled existing operation. No transaction sent." }));
  }
} finally { await getControlPool().end(); }
