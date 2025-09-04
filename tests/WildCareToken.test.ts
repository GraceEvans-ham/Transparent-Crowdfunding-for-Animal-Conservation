import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface MintRecord {
  minter: string;
  amount: number;
  recipient: string;
  timestamp: number;
}

interface ContractState {
  balances: Map<string, number>;
  allowances: Map<string, number>; // Key as "owner:spender"
  minters: Map<string, boolean>;
  blacklisted: Map<string, boolean>;
  roles: Map<string, boolean>; // Key as "user:role"
  mintHistory: Map<number, MintRecord>;
  totalSupply: number;
  maxSupply: number;
  mintCap: number;
  paused: boolean;
  admin: string;
  owner: string;
  tokenUri: string;
  mintCounter: number;
}

// Mock contract implementation
class WildCareTokenMock {
  private state: ContractState = {
    balances: new Map(),
    allowances: new Map(),
    minters: new Map(),
    blacklisted: new Map(),
    roles: new Map(),
    mintHistory: new Map(),
    totalSupply: 0,
    maxSupply: 1000000000,
    mintCap: 100000000,
    paused: false,
    admin: "deployer",
    owner: "deployer",
    tokenUri: "https://wildcare.example/token-metadata.json",
    mintCounter: 0,
  };

  private MAX_METADATA_LEN = 256;

  private ERR_NOT_AUTHORIZED = 401;
  private ERR_INSUFFICIENT_BALANCE = 402;
  private ERR_PAUSED = 403;
  private ERR_BLACKLISTED = 404;
  private ERR_INVALID_AMOUNT = 405;
  private ERR_INVALID_RECIPIENT = 406;
  private ERR_MAX_SUPPLY_REACHED = 407;
  private ERR_ALREADY_INITIALIZED = 408;
  private ERR_NOT_ADMIN = 409;
  private ERR_NOT_MINTER = 410;
  private ERR_METADATA_TOO_LONG = 411;
  private ERR_INVALID_ROLE = 412;

  initialize(caller: string, initialAdmin: string, initialUri: string): ClarityResponse<boolean> {
    if (caller !== this.state.owner) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    if (this.state.admin !== "deployer") {
      return { ok: false, value: this.ERR_ALREADY_INITIALIZED };
    }
    this.state.admin = initialAdmin;
    this.state.tokenUri = initialUri;
    this.state.minters.set(initialAdmin, true);
    return { ok: true, value: true };
  }

  transfer(caller: string, amount: number, sender: string, recipient: string, memo?: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (caller !== sender) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    if (this.state.blacklisted.get(recipient) ?? false) {
      return { ok: false, value: this.ERR_BLACKLISTED };
    }
    const senderBalance = this.state.balances.get(sender) ?? 0;
    if (senderBalance < amount) {
      return { ok: false, value: this.ERR_INSUFFICIENT_BALANCE };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    if (recipient === "invalid") {
      return { ok: false, value: this.ERR_INVALID_RECIPIENT };
    }
    this.state.balances.set(sender, senderBalance - amount);
    const recipientBalance = this.state.balances.get(recipient) ?? 0;
    this.state.balances.set(recipient, recipientBalance + amount);
    return { ok: true, value: true };
  }

  transferFrom(caller: string, amount: number, owner: string, recipient: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const allowanceKey = `${owner}:${caller}`;
    const allowance = this.state.allowances.get(allowanceKey) ?? 0;
    if (allowance < amount) {
      return { ok: false, value: this.ERR_INSUFFICIENT_BALANCE };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    const ownerBalance = this.state.balances.get(owner) ?? 0;
    if (ownerBalance < amount) {
      return { ok: false, value: this.ERR_INSUFFICIENT_BALANCE };
    }
    this.state.balances.set(owner, ownerBalance - amount);
    const recipientBalance = this.state.balances.get(recipient) ?? 0;
    this.state.balances.set(recipient, recipientBalance + amount);
    this.state.allowances.set(allowanceKey, allowance - amount);
    return { ok: true, value: true };
  }

  approve(caller: string, spender: string, amount: number): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const allowanceKey = `${caller}:${spender}`;
    this.state.allowances.set(allowanceKey, amount);
    return { ok: true, value: true };
  }

  getBalance(account: string): ClarityResponse<number> {
    return { ok: true, value: this.state.balances.get(account) ?? 0 };
  }

  getTotalSupply(): ClarityResponse<number> {
    return { ok: true, value: this.state.totalSupply };
  }

  getName(): ClarityResponse<string> {
    return { ok: true, value: "WildCare Token" };
  }

  getSymbol(): ClarityResponse<string> {
    return { ok: true, value: "WCT" };
  }

  getDecimals(): ClarityResponse<number> {
    return { ok: true, value: 6 };
  }

  getTokenUri(): ClarityResponse<string | null> {
    return { ok: true, value: this.state.tokenUri };
  }

  mint(caller: string, amount: number, recipient: string, metadata: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!(this.state.minters.get(caller) ?? false)) {
      return { ok: false, value: this.ERR_NOT_MINTER };
    }
    if (amount > this.state.mintCap) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    console.log(`Minting: totalSupply=${this.state.totalSupply}, amount=${amount}, maxSupply=${this.state.maxSupply}`);
    if (this.state.totalSupply + amount > this.state.maxSupply) {
      return { ok: false, value: this.ERR_MAX_SUPPLY_REACHED };
    }
    if (metadata.length > this.MAX_METADATA_LEN) {
      return { ok: false, value: this.ERR_METADATA_TOO_LONG };
    }
    const recipientBalance = this.state.balances.get(recipient) ?? 0;
    this.state.balances.set(recipient, recipientBalance + amount);
    this.state.totalSupply += amount;
    const id = this.state.mintCounter + 1;
    this.state.mintHistory.set(id, { minter: caller, amount, recipient, timestamp: Date.now() });
    this.state.mintCounter = id;
    return { ok: true, value: true };
  }

  burn(caller: string, amount: number): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const senderBalance = this.state.balances.get(caller) ?? 0;
    if (senderBalance < amount || amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    this.state.balances.set(caller, senderBalance - amount);
    this.state.totalSupply -= amount;
    return { ok: true, value: true };
  }

  pause(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_ADMIN };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpause(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_ADMIN };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  addMinter(caller: string, newMinter: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_ADMIN };
    }
    this.state.minters.set(newMinter, true);
    return { ok: true, value: true };
  }

  removeMinter(caller: string, minter: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_ADMIN };
    }
    this.state.minters.set(minter, false);
    return { ok: true, value: true };
  }

  blacklist(caller: string, account: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_ADMIN };
    }
    this.state.blacklisted.set(account, true);
    return { ok: true, value: true };
  }

  unblacklist(caller: string, account: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_ADMIN };
    }
    this.state.blacklisted.set(account, false);
    return { ok: true, value: true };
  }

  setMintCap(caller: string, newCap: number): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_ADMIN };
    }
    this.state.mintCap = newCap;
    return { ok: true, value: true };
  }

  assignRole(caller: string, user: string, role: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_ADMIN };
    }
    if (!["admin", "minter", "auditor"].includes(role)) {
      return { ok: false, value: this.ERR_INVALID_ROLE };
    }
    const roleKey = `${user}:${role}`;
    this.state.roles.set(roleKey, true);
    return { ok: true, value: true };
  }

  revokeRole(caller: string, user: string, role: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_ADMIN };
    }
    const roleKey = `${user}:${role}`;
    this.state.roles.delete(roleKey);
    return { ok: true, value: true };
  }

  hasRole(user: string, role: string): ClarityResponse<boolean> {
    const roleKey = `${user}:${role}`;
    return { ok: true, value: this.state.roles.get(roleKey) ?? false };
  }

  getMintHistory(id: number): ClarityResponse<MintRecord | null> {
    return { ok: true, value: this.state.mintHistory.get(id) ?? null };
  }

  isPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  isMinter(account: string): ClarityResponse<boolean> {
    return { ok: true, value: this.state.minters.get(account) ?? false };
  }

  isBlacklisted(account: string): ClarityResponse<boolean> {
    return { ok: true, value: this.state.blacklisted.get(account) ?? false };
  }

  getAllowance(owner: string, spender: string): ClarityResponse<number> {
    const allowanceKey = `${owner}:${spender}`;
    return { ok: true, value: this.state.allowances.get(allowanceKey) ?? 0 };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  minter: "wallet_1",
  user1: "wallet_2",
  user2: "wallet_3",
};

describe("WildCareToken Contract", () => {
  let contract: WildCareTokenMock;

  beforeEach(() => {
    contract = new WildCareTokenMock();
    vi.resetAllMocks();
  });

  it("should initialize with correct admin and URI", () => {
    const initResult = contract.initialize(accounts.deployer, accounts.deployer, "new-uri");
    expect(initResult).toEqual({ ok: true, value: true });
    expect(contract.getTokenUri()).toEqual({ ok: true, value: "new-uri" });
  });

  it("should prevent non-owner from initializing", () => {
    const initResult = contract.initialize(accounts.user1, accounts.user1, "new-uri");
    expect(initResult).toEqual({ ok: false, value: 401 });
  });

  it("should allow admin to add minter", () => {
    contract.initialize(accounts.deployer, accounts.deployer, "uri");
    const addMinter = contract.addMinter(accounts.deployer, accounts.minter);
    expect(addMinter).toEqual({ ok: true, value: true });
    expect(contract.isMinter(accounts.minter)).toEqual({ ok: true, value: true });
  });

  it("should prevent non-admin from adding minter", () => {
    contract.initialize(accounts.deployer, accounts.deployer, "uri");
    const addMinter = contract.addMinter(accounts.user1, accounts.minter);
    expect(addMinter).toEqual({ ok: false, value: 409 });
  });

  it("should allow minter to mint tokens with metadata", () => {
    contract.initialize(accounts.deployer, accounts.deployer, "uri");
    contract.addMinter(accounts.deployer, accounts.minter);
    const mintResult = contract.mint(accounts.minter, 1000, accounts.user1, "Metadata");
    expect(mintResult).toEqual({ ok: true, value: true });
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 1000 });
    expect(contract.getTotalSupply()).toEqual({ ok: true, value: 1000 });
    const mintRecord = contract.getMintHistory(1);
    expect(mintRecord).toEqual({
      ok: true,
      value: expect.objectContaining({
        amount: 1000,
        recipient: accounts.user1,
      }),
    });
  });

  it("should prevent minting over max supply", () => {
    contract.initialize(accounts.deployer, accounts.deployer, "uri");
    contract.addMinter(accounts.deployer, accounts.minter);
    // Mint 100000000 tokens 10 times to reach maxSupply (1000000000)
    for (let i = 0; i < 10; i++) {
      const mintResult = contract.mint(accounts.minter, 100000000, accounts.user1, "Metadata");
      expect(mintResult).toEqual({ ok: true, value: true });
    }
    expect(contract.getTotalSupply()).toEqual({ ok: true, value: 1000000000 });
    const mintOver = contract.mint(accounts.minter, 1, accounts.user1, "Metadata");
    expect(mintOver).toEqual({ ok: false, value: 407 });
  });

  it("should allow token transfer", () => {
    contract.initialize(accounts.deployer, accounts.deployer, "uri");
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.mint(accounts.minter, 1000, accounts.user1, "Metadata");
    const transferResult = contract.transfer(accounts.user1, 500, accounts.user1, accounts.user2);
    expect(transferResult).toEqual({ ok: true, value: true });
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 500 });
    expect(contract.getBalance(accounts.user2)).toEqual({ ok: true, value: 500 });
  });

  it("should prevent transfer to blacklisted account", () => {
    contract.initialize(accounts.deployer, accounts.deployer, "uri");
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.mint(accounts.minter, 1000, accounts.user1, "Metadata");
    contract.blacklist(accounts.deployer, accounts.user2);
    const transferResult = contract.transfer(accounts.user1, 500, accounts.user1, accounts.user2);
    expect(transferResult).toEqual({ ok: false, value: 404 });
  });

  it("should allow approval and transfer-from", () => {
    contract.initialize(accounts.deployer, accounts.deployer, "uri");
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.mint(accounts.minter, 1000, accounts.user1, "Metadata");
    contract.approve(accounts.user1, accounts.user2, 500);
    const transferFrom = contract.transferFrom(accounts.user2, 300, accounts.user1, accounts.user2);
    expect(transferFrom).toEqual({ ok: true, value: true });
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 700 });
    expect(contract.getBalance(accounts.user2)).toEqual({ ok: true, value: 300 });
    expect(contract.getAllowance(accounts.user1, accounts.user2)).toEqual({ ok: true, value: 200 });
  });

  it("should allow burning tokens", () => {
    contract.initialize(accounts.deployer, accounts.deployer, "uri");
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.mint(accounts.minter, 1000, accounts.user1, "Metadata");
    const burnResult = contract.burn(accounts.user1, 300);
    expect(burnResult).toEqual({ ok: true, value: true });
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 700 });
    expect(contract.getTotalSupply()).toEqual({ ok: true, value: 700 });
  });

  it("should pause and unpause contract", () => {
    contract.initialize(accounts.deployer, accounts.deployer, "uri");
    const pauseResult = contract.pause(accounts.deployer);
    expect(pauseResult).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: true });
    const mintDuringPause = contract.mint(accounts.deployer, 1000, accounts.user1, "Paused");
    expect(mintDuringPause).toEqual({ ok: false, value: 403 });
    const unpauseResult = contract.unpause(accounts.deployer);
    expect(unpauseResult).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: false });
  });

  it("should assign and check roles", () => {
    contract.initialize(accounts.deployer, accounts.deployer, "uri");
    const assignResult = contract.assignRole(accounts.deployer, accounts.user1, "auditor");
    expect(assignResult).toEqual({ ok: true, value: true });
    expect(contract.hasRole(accounts.user1, "auditor")).toEqual({ ok: true, value: true });
    const revokeResult = contract.revokeRole(accounts.deployer, accounts.user1, "auditor");
    expect(revokeResult).toEqual({ ok: true, value: true });
    expect(contract.hasRole(accounts.user1, "auditor")).toEqual({ ok: true, value: false });
  });

  it("should prevent invalid role assignment", () => {
    contract.initialize(accounts.deployer, accounts.deployer, "uri");
    const assignResult = contract.assignRole(accounts.deployer, accounts.user1, "invalid");
    expect(assignResult).toEqual({ ok: false, value: 412 });
  });

  it("should prevent metadata exceeding max length in mint", () => {
    contract.initialize(accounts.deployer, accounts.deployer, "uri");
    contract.addMinter(accounts.deployer, accounts.minter);
    const longMetadata = "a".repeat(257);
    const mintResult = contract.mint(accounts.minter, 1000, accounts.user1, longMetadata);
    expect(mintResult).toEqual({ ok: false, value: 411 });
  });
});