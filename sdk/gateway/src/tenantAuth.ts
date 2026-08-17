import { Connection, PublicKey } from '@solana/web3.js';

export const CLEARING_REGISTRY_PROGRAM_ID = new PublicKey(
  'Hg5QvSsnb22gHexUTnvvfff3EJZxWnsFKRM8bZ8n7Jmo',
);

export const REGISTRY_SEED = Buffer.from('registry');
export const TENANT_SEED = Buffer.from('tenant');

export interface TenantAccount {
  id: number;
  authority: PublicKey;
  label: string;
  feeBps: number;
  defaultFundContributionBps: number;
  status: 'active' | 'paused' | 'banned';
  nettingVenueId: number | null;
  vaultProgram: PublicKey;
  createdAt: number;
  bump: number;
}

/**
 * Derive the registry singleton PDA.
 */
export function deriveRegistryPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [REGISTRY_SEED],
    CLEARING_REGISTRY_PROGRAM_ID,
  );
}

/**
 * Derive a tenant PDA from its u32 id.
 */
export function deriveTenantPda(tenantId: number): [PublicKey, number] {
  const idBuf = Buffer.alloc(4, 0);
  idBuf.writeUInt32LE(tenantId);
  return PublicKey.findProgramAddressSync(
    [TENANT_SEED, idBuf],
    CLEARING_REGISTRY_PROGRAM_ID,
  );
}

/**
 * Parse raw account data into a TenantAccount.
 * Layout after 8-byte discriminator:
 *   id: u32 (4)
 *   authority: Pubkey (32)
 *   label: [u8; 32]
 *   fee_bps: u16 (2)
 *   default_fund_contribution_bps: u16 (2)
 *   status: u8 (1)
 *   netting_venue_id: Option<u8> — tag (1) + value (1)
 *   vault_program: Pubkey (32)
 *   created_at: i64 (8)
 *   bump: u8 (1)
 */
function parseTenant(data: Buffer): TenantAccount {
  let offset = 8; // skip discriminator
  const id = data.readUInt32LE(offset); offset += 4;
  const authority = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  const labelRaw = data.slice(offset, offset + 32); offset += 32;
  const label = labelRaw.toString('utf8').replace(/\0/g, '');
  const feeBps = data.readUInt16LE(offset); offset += 2;
  const defaultFundContributionBps = data.readUInt16LE(offset); offset += 2;
  const statusByte = data[offset]; offset += 1;
  const status = statusByte === 0 ? 'active' : statusByte === 1 ? 'paused' : 'banned';
  const hasVenue = data[offset] === 1; offset += 1;
  const nettingVenueId = hasVenue ? data[offset] : null; offset += hasVenue ? 1 : 0;
  const vaultProgram = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  const createdAt = Number(data.readBigInt64LE(offset)); offset += 8;
  const bump = data[offset]; offset += 1;

  return { id, authority, label, feeBps, defaultFundContributionBps, status, nettingVenueId, vaultProgram, createdAt, bump };
}

/**
 * Fetch a tenant account from on-chain by its id.
 */
export async function fetchTenant(
  connection: Connection,
  tenantId: number,
): Promise<TenantAccount | null> {
  const [tenantPda] = deriveTenantPda(tenantId);
  const acc = await connection.getAccountInfo(tenantPda);
  if (!acc || acc.data.length < 10) return null;
  return parseTenant(acc.data);
}

/**
 * Fetch the registry config account.
 */
export async function fetchRegistryConfig(
  connection: Connection,
): Promise<{ admin: PublicKey; nettingAdmin: PublicKey; tenantCount: number; paused: boolean; bump: number } | null> {
  const [registryPda] = deriveRegistryPda();
  const acc = await connection.getAccountInfo(registryPda);
  if (!acc || acc.data.length < 10) return null;
  const data = acc.data;
  let offset = 8;
  const admin = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  const nettingAdmin = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  const tenantCount = data.readUInt32LE(offset); offset += 4;
  const paused = data[offset] !== 0; offset += 1;
  const bump = data[offset]; offset += 1;
  return { admin, nettingAdmin, tenantCount, paused, bump };
}

/**
 * Verify that a tenant is active and its authority matches the expected key.
 * Returns the TenantAccount if valid, throws if not.
 */
export async function verifyTenant(
  connection: Connection,
  tenantId: number,
  expectedAuthority: PublicKey,
): Promise<TenantAccount> {
  const tenant = await fetchTenant(connection, tenantId);
  if (!tenant) throw new Error(`tenant-${tenantId}-not-found`);
  if (tenant.status !== 'active') throw new Error(`tenant-${tenantId}-not-active`);
  if (!tenant.authority.equals(expectedAuthority)) {
    throw new Error(`tenant-${tenantId}-authority-mismatch`);
  }
  return tenant;
}

/**
 * On-chain tenant auth gate — verify that a program PDA is the registered
 * authority for a specific tenant. Used as a guard before CPI calls.
 */
export async function checkTenantAuthority(
  connection: Connection,
  tenantId: number,
  programAuthority: PublicKey,
): Promise<boolean> {
  try {
    await verifyTenant(connection, tenantId, programAuthority);
    return true;
  } catch {
    return false;
  }
}
