/**
 * Tenant Onboarding SDK.
 *
 * Multi-step onboarding flow for registering a new tenant in the
 * clearing-registry and setting up their venue in the netting engine.
 *
 * Flow:
 *   1. deriveAccounts() — derive all PDAs needed for registration
 *   2. buildInitializeTx() — (one-time) initialize the registry
 *   3. buildRegisterTenantTx() — register tenant + CPI into netting engine
 *   4. buildRegisterExistingTenantTx() — register against existing venue
 *   5. buildUpdateTenantTx() — update tenant params post-registration
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';

export const CLEARING_REGISTRY_PROGRAM_ID = new PublicKey(
  'Hg5QvSsnb22gHexUTnvvfff3EJZxWnsFKRM8bZ8n7Jmo',
);

const REGISTRY_SEED = Buffer.from('registry');
const TENANT_SEED = Buffer.from('tenant');

/** Tenant registration parameters. */
export interface TenantRegistrationParams {
  /** Human-readable label (max 32 bytes). */
  label: string;
  /** Tenant's fee share (bps of 10_000). */
  feeBps: number;
  /** Default-fund contribution rate (bps). */
  defaultFundContributionBps: number;
  /** The tenant program's signing authority PDA. */
  authority: PublicKey;
  /** The program that will report fills. */
  ownerProgram: PublicKey;
  /** The vault program for settlement. */
  vaultProgram: PublicKey;
}

/** For register_existing_tenant: additional venue ID. */
export interface ExistingTenantParams extends TenantRegistrationParams {
  venueId: number;
}

/** For register_tenant (new venue): CPI params. */
export interface NewTenantParams extends TenantRegistrationParams {
  venueKind: number;
  marginBps: number;
  haircutBps: number;
}

/** Derived accounts for a tenant registration. */
export interface TenantAccounts {
  registryPda: PublicKey;
  tenantPda: PublicKey;
  tenantBump: number;
}

/**
 * Tenant Onboarding — builds transactions for the clearing-registry.
 */
export class TenantOnboarding {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /** Derive the registry singleton PDA. */
  deriveRegistryPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [REGISTRY_SEED],
      CLEARING_REGISTRY_PROGRAM_ID,
    );
  }

  /** Derive a tenant PDA from its u32 id. */
  deriveTenantPda(tenantId: number): [PublicKey, number] {
    const idBuf = Buffer.alloc(4, 0);
    idBuf.writeUInt32LE(tenantId);
    return PublicKey.findProgramAddressSync(
      [TENANT_SEED, idBuf],
      CLEARING_REGISTRY_PROGRAM_ID,
    );
  }

  /** Derive all accounts needed for a tenant registration at the given index. */
  deriveAccounts(tenantIndex: number): TenantAccounts {
    const [registryPda] = this.deriveRegistryPda();
    const [tenantPda, tenantBump] = this.deriveTenantPda(tenantIndex);
    return { registryPda, tenantPda, tenantBump };
  }

  /** Fetch the current tenant count from the registry. */
  async getTenantCount(): Promise<number> {
    const [registryPda] = this.deriveRegistryPda();
    const acc = await this.connection.getAccountInfo(registryPda);
    if (!acc || acc.data.length < 10) return 0;
    // RegistryConfig layout: 8 disc + admin(32) + netting_admin(32) + tenant_count(4)
    return acc.data.readUInt32LE(72);
  }

  /**
   * Build the initialize instruction (one-time, idempotent).
   * The registry admin calls this to create the singleton PDA.
   */
  buildInitializeIx(admin: PublicKey, nettingAdmin: PublicKey): TransactionInstruction {
    const [registryPda] = this.deriveRegistryPda();

    const discriminator = Buffer.from(
      [0x17, 0x76, 0xf8, 0x88, 0x4c, 0x4b, 0xb2, 0x3e], // sha256("global:initialize")[:8]
    );

    return new TransactionInstruction({
      keys: [
        { pubkey: admin, isSigner: true, isWritable: true },
        { pubkey: registryPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: CLEARING_REGISTRY_PROGRAM_ID,
      data: Buffer.concat([discriminator, nettingAdmin.toBuffer()]),
    });
  }

  /**
   * Build the register_existing_tenant instruction.
   * Used for onboarding tenants that already have a netting-engine venue.
   */
  async buildRegisterExistingTenantIx(
    admin: Keypair,
    params: ExistingTenantParams,
    tenantIndex?: number,
  ): Promise<TransactionInstruction> {
    const idx = tenantIndex ?? await this.getTenantCount();
    const { registryPda, tenantPda } = this.deriveAccounts(idx);

    const discriminator = Buffer.from(
      [0xe4, 0x26, 0x7c, 0x0d, 0xf3, 0x1d, 0x64, 0x89], // sha256("global:register_existing_tenant")[:8]
    );

    const labelBuf = Buffer.alloc(32, 0);
    labelBuf.write(params.label, 0, 'utf8');

    const data = Buffer.concat([
      discriminator,
      labelBuf,
      Buffer.from([params.feeBps & 0xff, (params.feeBps >> 8) & 0xff]),
      Buffer.from([
        params.defaultFundContributionBps & 0xff,
        (params.defaultFundContributionBps >> 8) & 0xff,
      ]),
      Buffer.from([params.venueId]),
    ]);

    return new TransactionInstruction({
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: registryPda, isSigner: false, isWritable: true },
        { pubkey: tenantPda, isSigner: false, isWritable: true },
        { pubkey: params.authority, isSigner: false, isWritable: false },
        { pubkey: params.ownerProgram, isSigner: false, isWritable: false },
        { pubkey: params.vaultProgram, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: CLEARING_REGISTRY_PROGRAM_ID,
      data,
    });
  }

  /**
   * Build the register_tenant instruction (new venue via CPI).
   * The netting_admin must also sign.
   */
  async buildRegisterTenantIx(
    admin: Keypair,
    nettingAdmin: Keypair,
    params: NewTenantParams,
    nettingConfig: PublicKey,
    nettingVenue: PublicKey,
    tenantIndex?: number,
  ): Promise<TransactionInstruction> {
    const idx = tenantIndex ?? await this.getTenantCount();
    const { registryPda, tenantPda } = this.deriveAccounts(idx);

    const discriminator = Buffer.from(
      [0xc8, 0x8e, 0x5d, 0x6e, 0x48, 0x5b, 0x24, 0x83], // sha256("global:register_tenant")[:8]
    );

    const labelBuf = Buffer.alloc(32, 0);
    labelBuf.write(params.label, 0, 'utf8');

    const data = Buffer.concat([
      discriminator,
      labelBuf,
      Buffer.from([params.feeBps & 0xff, (params.feeBps >> 8) & 0xff]),
      Buffer.from([
        params.defaultFundContributionBps & 0xff,
        (params.defaultFundContributionBps >> 8) & 0xff,
      ]),
      Buffer.from([params.venueKind]),
      Buffer.from([params.marginBps & 0xff, (params.marginBps >> 8) & 0xff]),
      Buffer.from([params.haircutBps & 0xff, (params.haircutBps >> 8) & 0xff]),
    ]);

    return new TransactionInstruction({
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: registryPda, isSigner: false, isWritable: true },
        { pubkey: tenantPda, isSigner: false, isWritable: true },
        { pubkey: params.authority, isSigner: false, isWritable: false },
        { pubkey: params.ownerProgram, isSigner: false, isWritable: false },
        { pubkey: params.vaultProgram, isSigner: false, isWritable: false },
        { pubkey: nettingAdmin.publicKey, isSigner: true, isWritable: true },
        { pubkey: nettingVenue, isSigner: false, isWritable: true },
        { pubkey: nettingConfig, isSigner: false, isWritable: true },
        {
          pubkey: new PublicKey('68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56'),
          isSigner: false,
          isWritable: false,
        },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: CLEARING_REGISTRY_PROGRAM_ID,
      data,
    });
  }

  /**
   * Build the update_tenant instruction.
   */
  buildUpdateTenantIx(
    admin: Keypair,
    tenantId: number,
    updates: {
      feeBps?: number;
      defaultFundContributionBps?: number;
      status?: number;
    },
  ): TransactionInstruction {
    const { registryPda, tenantPda } = this.deriveAccounts(tenantId);

    const discriminator = Buffer.from(
      [0x6e, 0x2a, 0x87, 0x17, 0x8b, 0x19, 0x34, 0x34], // sha256("global:update_tenant")[:8]
    );

    // Encode Option<u16> for fee_bps
    const feeBpsData = updates.feeBps !== undefined
      ? Buffer.concat([Buffer.from([1]), Buffer.from([updates.feeBps & 0xff, (updates.feeBps >> 8) & 0xff])])
      : Buffer.from([0]);

    const dfcData = updates.defaultFundContributionBps !== undefined
      ? Buffer.concat([Buffer.from([1]), Buffer.from([updates.defaultFundContributionBps & 0xff, (updates.defaultFundContributionBps >> 8) & 0xff])])
      : Buffer.from([0]);

    const statusData = updates.status !== undefined
      ? Buffer.concat([Buffer.from([1]), Buffer.from([updates.status])])
      : Buffer.from([0]);

    const data = Buffer.concat([discriminator, feeBpsData, dfcData, statusData]);

    return new TransactionInstruction({
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: registryPda, isSigner: false, isWritable: false },
        { pubkey: tenantPda, isSigner: false, isWritable: true },
      ],
      programId: CLEARING_REGISTRY_PROGRAM_ID,
      data,
    });
  }

  /**
   * Full onboarding flow: build a multi-instruction transaction that
   * initializes the registry (if needed) and registers a tenant.
   */
  async buildOnboardingTx(
    admin: Keypair,
    params: ExistingTenantParams,
  ): Promise<Transaction> {
    const tenantCount = await this.getTenantCount();
    const { registryPda, tenantPda } = this.deriveAccounts(tenantCount);

    const ixs: TransactionInstruction[] = [];

    // If registry doesn't exist, initialize it first.
    if (tenantCount === 0) {
      ixs.push(this.buildInitializeIx(admin.publicKey, admin.publicKey));
    }

    // Register the tenant.
    ixs.push(await this.buildRegisterExistingTenantIx(admin, params, tenantCount));

    const tx = new Transaction().add(...ixs);
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = admin.publicKey;

    return tx;
  }
}
