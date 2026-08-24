const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram } = require("@solana/web3.js");
const fs = require("fs");
const crypto = require("crypto");

const PROGRAM_ID = new PublicKey("6uvr2JcP2iMQooG76RjpCtJLoJ4NuptGyRCiMKuDR1ws");

function disc(name) {
  return crypto.createHash("sha256").update("global:" + name).digest().slice(0, 8);
}

async function main() {
  const conn = new Connection(`https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY || ""}`, "confirmed");
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("/home/kezz/.config/solana/new-id.json"))));
  console.log("Admin:", keypair.publicKey.toBase58());

  const [ptConfigPda] = PublicKey.findProgramAddressSync([Buffer.from("pt-config")], PROGRAM_ID);
  const [timelockedAdminPda] = PublicKey.findProgramAddressSync([Buffer.from("timelocked-admin")], PROGRAM_ID);

  // Test 1: try resize_pt_config
  console.log("\n=== Test resize_pt_config ===");
  const data1 = disc("resize_pt_config");
  const ix1 = new TransactionInstruction({
    keys: [
      { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: ptConfigPda, isSigner: false, isWritable: true },
      { pubkey: timelockedAdminPda, isSigner: false, isWritable: false },
      { pubkey: PublicKey.default, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: data1,
  });
  const tx1 = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }),
    ix1
  );
  try {
    const sim = await conn.simulateTransaction(tx1, [keypair]);
    console.log("Sim logs:", sim.value.logs?.filter(l => l.includes("Program")).join("\n"));
    console.log("Sim error:", sim.value.err);
    if (!sim.value.err) {
      const sig = await conn.sendTransaction(tx1, [keypair]);
      console.log("Tx:", sig);
    }
  } catch (e) {
    console.log("Error:", e.message?.slice(0, 200));
  }

  // Test 2: try set_granular_pause
  console.log("\n=== Test set_granular_pause ===");
  const data2 = Buffer.alloc(1 + 4); // disc(8) + 4 bools packed as u8
  disc("set_granular_pause").copy(data2, 0);
  data2.writeUInt8(0, 8); // pause_opens = false
  data2.writeUInt8(0, 9); // pause_deposits = false  
  data2.writeUInt8(0, 10); // pause_withdrawals = false
  data2.writeUInt8(0, 11); // pause_liquidations = false
  const ix2 = new TransactionInstruction({
    keys: [
      { pubkey: keypair.publicKey, isSigner: true, isWritable: false },
      { pubkey: ptConfigPda, isSigner: false, isWritable: true },
      { pubkey: timelockedAdminPda, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: data2,
  });
  const tx2 = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }),
    ix2
  );
  try {
    const sim = await conn.simulateTransaction(tx2, [keypair]);
    console.log("Sim logs:", sim.value.logs?.filter(l => l.includes("Program")).join("\n"));
    console.log("Sim error:", sim.value.err);
  } catch (e) {
    console.log("Error:", e.message?.slice(0, 200));
  }
}

main().catch(console.error);
