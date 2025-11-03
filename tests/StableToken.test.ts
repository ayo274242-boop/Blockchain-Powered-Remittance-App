import { describe, it, expect, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const ERR_UNAUTHORIZED = 100;
const ERR_INSUFFICIENT_BALANCE = 101;
const ERR_TRANSFER_FAILED = 102;
const ERR_BURN_FAILED = 103;
const ERR_MINT_FAILED = 104;
const ERR_INVALID_AMOUNT = 105;
const ERR_NOT_OWNER = 106;
const ERR_PAUSED = 107;
const ERR_ALREADY_PAUSED = 108;
const ERR_NOT_PAUSED = 109;
const ERR_INVALID_RECIPIENT = 110;
const ERR_SUPPLY_CAP_REACHED = 112;
const ERR_ZERO_ADDRESS = 113;

interface TokenState {
  totalSupply: bigint;
  balances: Map<string, bigint>;
  totalMinted: bigint;
  paused: boolean;
  owner: string;
  minters: Set<string>;
  burners: Set<string>;
  pausers: Set<string>;
  metadataUri: string;
}

class StableTokenMock {
  state: TokenState;
  caller: string;
  contractPrincipal: string;

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      totalSupply: BigInt(0),
      balances: new Map(),
      totalMinted: BigInt(0),
      paused: false,
      owner: "ST1OWNER",
      minters: new Set(["ST1OWNER"]),
      burners: new Set(["ST1OWNER"]),
      pausers: new Set(["ST1OWNER"]),
      metadataUri: "https://api.seamlessremit.io/metadata/susd.json",
    };
    this.caller = "ST1OWNER";
    this.contractPrincipal = "ST1CONTRACT.stable-token";
  }

  private assertNotPaused(): Result<boolean> {
    return this.state.paused ? { ok: false, value: ERR_PAUSED } : { ok: true, value: true };
  }

  private assertValidAmount(amount: bigint): Result<boolean> {
    return amount > BigInt(0) ? { ok: true, value: true } : { ok: false, value: ERR_INVALID_AMOUNT };
  }

  private assertValidRecipient(recipient: string): Result<boolean> {
    return recipient !== "SP000000000000000000002Q6VF78"
      ? { ok: true, value: true }
      : { ok: false, value: ERR_ZERO_ADDRESS };
  }

  private assertOwner(): Result<boolean> {
    return this.caller === this.state.owner
      ? { ok: true, value: true }
      : { ok: false, value: ERR_NOT_OWNER };
  }

  private assertMinter(): Result<boolean> {
    return this.state.minters.has(this.caller)
      ? { ok: true, value: true }
      : { ok: false, value: ERR_UNAUTHORIZED };
  }

  private assertBurner(): Result<boolean> {
    return this.state.burners.has(this.caller)
      ? { ok: true, value: true }
      : { ok: false, value: ERR_UNAUTHORIZED };
  }

  private assertPauser(): Result<boolean> {
    return this.state.pausers.has(this.caller)
      ? { ok: true, value: true }
      : { ok: false, value: ERR_UNAUTHORIZED };
  }

  getName(): Result<string> {
    return { ok: true, value: "Seamless USD" };
  }

  getSymbol(): Result<string> {
    return { ok: true, value: "sUSD" };
  }

  getDecimals(): Result<number> {
    return { ok: true, value: 6 };
  }

  getTotalSupply(): Result<bigint> {
    return { ok: true, value: this.state.totalSupply };
  }

  getBalanceOf(account: string): Result<bigint> {
    return { ok: true, value: this.state.balances.get(account) || BigInt(0) };
  }

  getMaxSupply(): Result<bigint> {
    return { ok: true, value: BigInt(1_000_000_000_000_000) };
  }

  getTokenUri(): Result<string | null> {
    return { ok: true, value: this.state.metadataUri };
  }

  isPaused(): Result<boolean> {
    return { ok: true, value: this.state.paused };
  }

  isMinter(account: string): Result<boolean> {
    return { ok: true, value: this.state.minters.has(account) };
  }

  isBurner(account: string): Result<boolean> {
    return { ok: true, value: this.state.burners.has(account) };
  }

  isPauser(account: string): Result<boolean> {
    return { ok: true, value: this.state.pausers.has(account) };
  }

  transfer(amount: bigint, sender: string, recipient: string): Result<boolean> {
    const assertPaused = this.assertNotPaused();
    if (!assertPaused.ok) return { ok: false, value: assertPaused.value };

    const assertAmount = this.assertValidAmount(amount);
    if (!assertAmount.ok) return { ok: false, value: assertAmount.value };

    const assertRecipient = this.assertValidRecipient(recipient);
    if (!assertRecipient.ok) return { ok: false, value: assertRecipient.value };

    if (this.caller !== sender) return { ok: false, value: ERR_UNAUTHORIZED };

    const senderBal = this.state.balances.get(sender) || BigInt(0);
    if (senderBal < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };

    this.state.balances.set(sender, senderBal - amount);
    this.state.balances.set(recipient, (this.state.balances.get(recipient) || BigInt(0)) + amount);
    return { ok: true, value: true };
  }

  mint(amount: bigint, recipient: string): Result<boolean> {
    const assertPaused = this.assertNotPaused();
    if (!assertPaused.ok) return { ok: false, value: assertPaused.value };

    const assertMinter = this.assertMinter();
    if (!assertMinter.ok) return { ok: false, value: assertMinter.value };

    const assertAmount = this.assertValidAmount(amount);
    if (!assertAmount.ok) return { ok: false, value: assertAmount.value };

    const assertRecipient = this.assertValidRecipient(recipient);
    if (!assertRecipient.ok) return { ok: false, value: assertRecipient.value };

    const newTotal = this.state.totalMinted + amount;
    if (newTotal > BigInt(1_000_000_000_000_000)) return { ok: false, value: ERR_SUPPLY_CAP_REACHED };

    this.state.totalSupply += amount;
    this.state.totalMinted = newTotal;
    this.state.balances.set(recipient, (this.state.balances.get(recipient) || BigInt(0)) + amount);
    return { ok: true, value: true };
  }

  burn(amount: bigint): Result<boolean> {
    const assertPaused = this.assertNotPaused();
    if (!assertPaused.ok) return { ok: false, value: assertPaused.value };

    const assertBurner = this.assertBurner();
    if (!assertBurner.ok) return { ok: false, value: assertBurner.value };

    const assertAmount = this.assertValidAmount(amount);
    if (!assertAmount.ok) return { ok: false, value: assertAmount.value };

    const balance = this.state.balances.get(this.caller) || BigInt(0);
    if (balance < amount) return { ok: false, value: ERR_INSUFFICIENT_BALANCE };

    this.state.balances.set(this.caller, balance - amount);
    this.state.totalSupply -= amount;
    return { ok: true, value: true };
  }

  pause(): Result<boolean> {
    const assertPauser = this.assertPauser();
    if (!assertPauser.ok) return { ok: false, value: assertPauser.value };

    if (this.state.paused) return { ok: false, value: ERR_ALREADY_PAUSED };

    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpause(): Result<boolean> {
    const assertPauser = this.assertPauser();
    if (!assertPauser.ok) return { ok: false, value: assertPauser.value };

    if (!this.state.paused) return { ok: false, value: ERR_NOT_PAUSED };

    this.state.paused = false;
    return { ok: true, value: true };
  }

  setMinter(account: string, enabled: boolean): Result<boolean> {
    const assertOwner = this.assertOwner();
    if (!assertOwner.ok) return { ok: false, value: assertOwner.value };

    if (enabled) this.state.minters.add(account);
    else this.state.minters.delete(account);
    return { ok: true, value: true };
  }

  setBurner(account: string, enabled: boolean): Result<boolean> {
    const assertOwner = this.assertOwner();
    if (!assertOwner.ok) return { ok: false, value: assertOwner.value };

    if (enabled) this.state.burners.add(account);
    else this.state.burners.delete(account);
    return { ok: true, value: true };
  }

  setPauser(account: string, enabled: boolean): Result<boolean> {
    const assertOwner = this.assertOwner();
    if (!assertOwner.ok) return { ok: false, value: assertOwner.value };

    if (enabled) this.state.pausers.add(account);
    else this.state.pausers.delete(account);
    return { ok: true, value: true };
  }

  updateMetadata(newUri: string): Result<boolean> {
    const assertOwner = this.assertOwner();
    if (!assertOwner.ok) return { ok: false, value: assertOwner.value };

    if (newUri.length === 0) return { ok: false, value: 114 };
    this.state.metadataUri = newUri;
    return { ok: true, value: true };
  }

  transferOwnership(newOwner: string): Result<boolean> {
    const assertOwner = this.assertOwner();
    if (!assertOwner.ok) return { ok: false, value: assertOwner.value };

    const assertRecipient = this.assertValidRecipient(newOwner);
    if (!assertRecipient.ok) return { ok: false, value: assertRecipient.value };

    this.state.owner = newOwner;
    return { ok: true, value: true };
  }
}

interface Result<T> {
  ok: boolean;
  value: T;
}

describe("StableToken", () => {
  let token: StableTokenMock;

  beforeEach(() => {
    token = new StableTokenMock();
    token.reset();
  });

  it("returns correct token metadata", () => {
    expect(token.getName().value).toBe("Seamless USD");
    expect(token.getSymbol().value).toBe("sUSD");
    expect(token.getDecimals().value).toBe(6);
    expect(token.getMaxSupply().value).toBe(BigInt(1_000_000_000_000_000));
  });

  it("mints tokens successfully as minter", () => {
    const result = token.mint(BigInt(1000_000_000), "ST1RECIPIENT");
    expect(result.ok).toBe(true);
    expect(token.getBalanceOf("ST1RECIPIENT").value).toBe(BigInt(1000_000_000));
    expect(token.getTotalSupply().value).toBe(BigInt(1000_000_000));
  });

  it("rejects mint by non-minter", () => {
    token.caller = "ST2USER";
    const result = token.mint(BigInt(1000_000_000), "ST1RECIPIENT");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });

  it("transfers tokens successfully", () => {
    token.mint(BigInt(500_000_000), "ST1SENDER");
    token.caller = "ST1SENDER";
    const result = token.transfer(BigInt(100_000_000), "ST1SENDER", "ST2RECIPIENT");
    expect(result.ok).toBe(true);
    expect(token.getBalanceOf("ST1SENDER").value).toBe(BigInt(400_000_000));
    expect(token.getBalanceOf("ST2RECIPIENT").value).toBe(BigInt(100_000_000));
  });

  it("rejects transfer when paused", () => {
    token.pause();
    token.mint(BigInt(500_000_000), "ST1SENDER");
    token.caller = "ST1SENDER";
    const result = token.transfer(BigInt(100_000_000), "ST1SENDER", "ST2RECIPIENT");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PAUSED);
  });

  it("pauses and unpauses contract", () => {
    const pauseResult = token.pause();
    expect(pauseResult.ok).toBe(true);
    expect(token.isPaused().value).toBe(true);

    const unpauseResult = token.unpause();
    expect(unpauseResult.ok).toBe(true);
    expect(token.isPaused().value).toBe(false);
  });

  it("rejects pause by non-pauser", () => {
    token.caller = "ST2USER";
    const result = token.pause();
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });

  it("allows owner to set roles", () => {
    token.setMinter("ST2MINTER", true);
    token.setBurner("ST2BURNER", true);
    token.setPauser("ST2PAUSER", true);

    expect(token.isMinter("ST2MINTER").value).toBe(true);
    expect(token.isBurner("ST2BURNER").value).toBe(true);
    expect(token.isPauser("ST2PAUSER").value).toBe(true);
  });

  it("updates metadata uri", () => {
    const result = token.updateMetadata("https://new-metadata.example.com");
    expect(result.ok).toBe(true);
    expect(token.getTokenUri().value).toBe("https://new-metadata.example.com");
  });

  it("transfers ownership", () => {
    const result = token.transferOwnership("ST2NEWOWNER");
    expect(result.ok).toBe(true);
    token.caller = "ST2NEWOWNER";
    expect(token.assertOwner().ok).toBe(true);
  });

  it("enforces supply cap", () => {
    token.caller = "ST1OWNER";
    const max = BigInt(1_000_000_000_000_000);
    token.mint(max, "ST1USER");
    const result = token.mint(BigInt(1), "ST1USER");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_SUPPLY_CAP_REACHED);
  });

  it("rejects zero address recipient", () => {
    const result = token.mint(BigInt(1000_000_000), "SP000000000000000000002Q6VF78");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ZERO_ADDRESS);
  });

  it("rejects invalid amounts", () => {
    const result = token.mint(BigInt(0), "ST1USER");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("handles multiple transfers correctly", () => {
    token.mint(BigInt(1000_000_000), "ST1A");
    token.caller = "ST1A";
    token.transfer(BigInt(300_000_000), "ST1A", "ST1B");
    token.transfer(BigInt(200_000_000), "ST1A", "ST1C");
    expect(token.getBalanceOf("ST1A").value).toBe(BigInt(500_000_000));
    expect(token.getBalanceOf("ST1B").value).toBe(BigInt(300_000_000));
    expect(token.getBalanceOf("ST1C").value).toBe(BigInt(200_000_000));
  });
});