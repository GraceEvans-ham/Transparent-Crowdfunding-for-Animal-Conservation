import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface Campaign {
  goal: number;
  raised: number;
  deadline: number;
  creator: string;
  active: boolean;
  refunded: boolean;
  milestoneCount: number;
}

interface Milestone {
  description: string;
  targetAmount: number;
  achieved: boolean;
  verified: boolean;
}

interface ContractState {
  campaigns: Map<number, Campaign>;
  contributions: Map<string, number>; // Key as "campaign-id:contributor"
  milestones: Map<string, Milestone>; // Key as "campaign-id:milestone-id"
  milestoneVerifications: Map<string, boolean>; // Key as "campaign-id:milestone-id:verifier"
  campaignCounter: number;
  paused: boolean;
  admin: string;
  minContribution: number;
  maxCampaignsPerCreator: number;
  creatorCampaignCount: Map<string, number>;
}

// Mock contract implementation
class CrowdfundMock {
  private state: ContractState = {
    campaigns: new Map(),
    contributions: new Map(),
    milestones: new Map(),
    milestoneVerifications: new Map(),
    campaignCounter: 0,
    paused: false,
    admin: "deployer",
    minContribution: 1,
    maxCampaignsPerCreator: 10,
    creatorCampaignCount: new Map(),
  };

  private ERR_CAMPAIGN_NOT_FOUND = 501;
  private ERR_DEADLINE_PASSED = 502;
  private ERR_NOT_ACTIVE = 503;
  private ERR_NOT_CREATOR = 504;
  private ERR_INSUFFICIENT_FUNDS = 505;
  private ERR_ALREADY_REFUNDED = 506;
  private ERR_MILESTONE_NOT_ACHIEVED = 507;
  private ERR_NOT_VERIFIER = 508;
  private ERR_INVALID_MILESTONE = 509;
  private ERR_PAUSED = 510;
  private ERR_NOT_ADMIN = 511;

  // Mock block height for testing
  private mockBlockHeight = 100;

  setMockBlockHeight(height: number) {
    this.mockBlockHeight = height;
  }

  createCampaign(caller: string, goal: number, deadline: number, initialMilestones: Array<{ description: string; targetAmount: number }>): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const currentCount = this.state.creatorCampaignCount.get(caller) ?? 0;
    if (currentCount >= this.state.maxCampaignsPerCreator) {
      return { ok: false, value: this.ERR_INVALID_MILESTONE };
    }
    const id = this.state.campaignCounter + 1;
    this.state.campaigns.set(id, {
      goal,
      raised: 0,
      deadline,
      creator: caller,
      active: true,
      refunded: false,
      milestoneCount: initialMilestones.length,
    });
    initialMilestones.forEach((milestone, index) => {
      const mid = index + 1;
      const key = `${id}:${mid}`;
      this.state.milestones.set(key, {
        description: milestone.description,
        targetAmount: milestone.targetAmount,
        achieved: false,
        verified: false,
      });
    });
    this.state.creatorCampaignCount.set(caller, currentCount + 1);
    this.state.campaignCounter = id;
    return { ok: true, value: id };
  }

  contribute(caller: string, campaignId: number, amount: number): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const campaign = this.state.campaigns.get(campaignId);
    if (!campaign) {
      return { ok: false, value: this.ERR_CAMPAIGN_NOT_FOUND };
    }
    if (!campaign.active) {
      return { ok: false, value: this.ERR_NOT_ACTIVE };
    }
    if (amount < this.state.minContribution) {
      return { ok: false, value: 405 }; // Reuse from token
    }
    if (this.mockBlockHeight >= campaign.deadline) {
      return { ok: false, value: this.ERR_DEADLINE_PASSED };
    }
    const key = `${campaignId}:${caller}`;
    const currentContrib = this.state.contributions.get(key) ?? 0;
    this.state.contributions.set(key, currentContrib + amount);
    campaign.raised += amount;
    this.state.campaigns.set(campaignId, campaign);
    this.checkMilestones(campaignId, campaign.raised);
    return { ok: true, value: true };
  }

  private checkMilestones(campaignId: number, raised: number) {
    const campaign = this.state.campaigns.get(campaignId);
    if (!campaign) return;
    for (let mid = 1; mid <= campaign.milestoneCount; mid++) {
      const key = `${campaignId}:${mid}`;
      const milestone = this.state.milestones.get(key);
      if (milestone && !milestone.achieved && raised >= milestone.targetAmount) {
        milestone.achieved = true;
        this.state.milestones.set(key, milestone);
      }
    }
  }

  refund(caller: string, campaignId: number): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const campaign = this.state.campaigns.get(campaignId);
    if (!campaign) {
      return { ok: false, value: this.ERR_CAMPAIGN_NOT_FOUND };
    }
    if (this.mockBlockHeight <= campaign.deadline) {
      return { ok: false, value: this.ERR_DEADLINE_PASSED };
    }
    if (campaign.raised >= campaign.goal) {
      return { ok: false, value: this.ERR_MILESTONE_NOT_ACHIEVED };
    }
    if (campaign.refunded) {
      return { ok: false, value: this.ERR_ALREADY_REFUNDED };
    }
    const key = `${campaignId}:${caller}`;
    const contribAmount = this.state.contributions.get(key) ?? 0;
    if (contribAmount <= 0) {
      return { ok: false, value: this.ERR_INSUFFICIENT_FUNDS };
    }
    this.state.contributions.set(key, 0);
    // In real, transfer back, here mock
    return { ok: true, value: true };
  }

  withdrawFunds(caller: string, campaignId: number, milestoneId: number): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const campaign = this.state.campaigns.get(campaignId);
    if (!campaign) {
      return { ok: false, value: this.ERR_CAMPAIGN_NOT_FOUND };
    }
    if (caller !== campaign.creator) {
      return { ok: false, value: this.ERR_NOT_CREATOR };
    }
    const key = `${campaignId}:${milestoneId}`;
    const milestone = this.state.milestones.get(key);
    if (!milestone) {
      return { ok: false, value: this.ERR_INVALID_MILESTONE };
    }
    if (!milestone.achieved || !milestone.verified) {
      return { ok: false, value: this.ERR_MILESTONE_NOT_ACHIEVED };
    }
    // Mock withdrawal
    milestone.verified = false; // Reset
    this.state.milestones.set(key, milestone);
    return { ok: true, value: true };
  }

  verifyMilestone(caller: string, campaignId: number, milestoneId: number, approve: boolean): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const vKey = `${campaignId}:${milestoneId}:${caller}`;
    if (!(this.state.milestoneVerifications.get(vKey) ?? false)) {
      return { ok: false, value: this.ERR_NOT_VERIFIER };
    }
    const mKey = `${campaignId}:${milestoneId}`;
    const milestone = this.state.milestones.get(mKey);
    if (!milestone) {
      return { ok: false, value: this.ERR_INVALID_MILESTONE };
    }
    if (approve) {
      milestone.verified = true;
      this.state.milestones.set(mKey, milestone);
    }
    return { ok: true, value: true };
  }

  addVerifier(caller: string, campaignId: number, milestoneId: number, verifier: string): ClarityResponse<boolean> {
    const campaign = this.state.campaigns.get(campaignId);
    if (!campaign || caller !== campaign.creator) {
      return { ok: false, value: this.ERR_NOT_CREATOR };
    }
    const vKey = `${campaignId}:${milestoneId}:${verifier}`;
    this.state.milestoneVerifications.set(vKey, true);
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

  setMinContribution(caller: string, newMin: number): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_ADMIN };
    }
    this.state.minContribution = newMin;
    return { ok: true, value: true };
  }

  getCampaign(id: number): ClarityResponse<Campaign | null> {
    return { ok: true, value: this.state.campaigns.get(id) ?? null };
  }

  getContribution(campaignId: number, contributor: string): ClarityResponse<number> {
    const key = `${campaignId}:${contributor}`;
    return { ok: true, value: this.state.contributions.get(key) ?? 0 };
  }

  getMilestone(campaignId: number, milestoneId: number): ClarityResponse<Milestone | null> {
    const key = `${campaignId}:${milestoneId}`;
    return { ok: true, value: this.state.milestones.get(key) ?? null };
  }

  isPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  creator: "wallet_1",
  contributor: "wallet_2",
  verifier: "wallet_3",
};

describe("Crowdfund Contract", () => {
  let contract: CrowdfundMock;

  beforeEach(() => {
    contract = new CrowdfundMock();
    vi.resetAllMocks();
  });

  it("should create a campaign with milestones", () => {
    const milestones = [
      { description: "Milestone 1", targetAmount: 500 },
      { description: "Milestone 2", targetAmount: 1000 },
    ];
    const createResult = contract.createCampaign(accounts.creator, 2000, 200, milestones);
    expect(createResult).toEqual({ ok: true, value: 1 });
    const campaign = contract.getCampaign(1);
    expect(campaign).toEqual({
      ok: true,
      value: expect.objectContaining({ goal: 2000, milestoneCount: 2 }),
    });
    const m1 = contract.getMilestone(1, 1);
    expect(m1).toEqual({
      ok: true,
      value: expect.objectContaining({ targetAmount: 500, achieved: false }),
    });
  });

  it("should allow contributions and check milestones", () => {
    contract.createCampaign(accounts.creator, 2000, 200, [
      { description: "M1", targetAmount: 500 },
      { description: "M2", targetAmount: 1000 },
    ]);
    const contrib1 = contract.contribute(accounts.contributor, 1, 600);
    expect(contrib1).toEqual({ ok: true, value: true });
    const m1 = contract.getMilestone(1, 1);
    expect(m1).toEqual({
      ok: true,
      value: expect.objectContaining({ achieved: true }),
    });
    const m2 = contract.getMilestone(1, 2);
    expect(m2).toEqual({
      ok: true,
      value: expect.objectContaining({ achieved: false }),
    });
    const contrib2 = contract.contribute(accounts.contributor, 1, 500);
    expect(contrib2).toEqual({ ok: true, value: true });
    const m2Updated = contract.getMilestone(1, 2);
    expect(m2Updated).toEqual({
      ok: true,
      value: expect.objectContaining({ achieved: true }),
    });
  });

  it("should prevent contribution below min", () => {
    contract.createCampaign(accounts.creator, 2000, 200, []);
    contract.setMinContribution(accounts.deployer, 10);
    const contrib = contract.contribute(accounts.contributor, 1, 5);
    expect(contrib).toEqual({ ok: false, value: 405 });
  });

  it("should allow refund if campaign failed", () => {
    contract.createCampaign(accounts.creator, 2000, 200, []);
    contract.contribute(accounts.contributor, 1, 1000);
    contract.setMockBlockHeight(201);
    const refundResult = contract.refund(accounts.contributor, 1);
    expect(refundResult).toEqual({ ok: true, value: true });
    const contribAfter = contract.getContribution(1, accounts.contributor);
    expect(contribAfter).toEqual({ ok: true, value: 0 });
  });

  it("should prevent refund if successful", () => {
    contract.createCampaign(accounts.creator, 2000, 200, []);
    contract.contribute(accounts.contributor, 1, 2000);
    contract.setMockBlockHeight(201);
    const refundResult = contract.refund(accounts.contributor, 1);
    expect(refundResult).toEqual({ ok: false, value: 507 });
  });

  it("should allow verifier to verify milestone", () => {
    contract.createCampaign(accounts.creator, 2000, 200, [{ description: "M1", targetAmount: 500 }]);
    contract.contribute(accounts.contributor, 1, 600);
    contract.addVerifier(accounts.creator, 1, 1, accounts.verifier);
    const verifyResult = contract.verifyMilestone(accounts.verifier, 1, 1, true);
    expect(verifyResult).toEqual({ ok: true, value: true });
    const m1 = contract.getMilestone(1, 1);
    expect(m1).toEqual({
      ok: true,
      value: expect.objectContaining({ verified: true }),
    });
  });

  it("should allow withdrawal after verification", () => {
    contract.createCampaign(accounts.creator, 2000, 200, [{ description: "M1", targetAmount: 500 }]);
    contract.contribute(accounts.contributor, 1, 600);
    contract.addVerifier(accounts.creator, 1, 1, accounts.verifier);
    contract.verifyMilestone(accounts.verifier, 1, 1, true);
    const withdrawResult = contract.withdrawFunds(accounts.creator, 1, 1);
    expect(withdrawResult).toEqual({ ok: true, value: true });
    const m1 = contract.getMilestone(1, 1);
    expect(m1).toEqual({
      ok: true,
      value: expect.objectContaining({ verified: false }),
    });
  });

  it("should prevent non-creator from adding verifier", () => {
    contract.createCampaign(accounts.creator, 2000, 200, []);
    const addResult = contract.addVerifier(accounts.contributor, 1, 1, accounts.verifier);
    expect(addResult).toEqual({ ok: false, value: 504 });
  });

  it("should pause and unpause contract", () => {
    const pauseResult = contract.pause(accounts.deployer);
    expect(pauseResult).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: true });
    const createDuringPause = contract.createCampaign(accounts.creator, 2000, 200, []);
    expect(createDuringPause).toEqual({ ok: false, value: 510 });
    const unpauseResult = contract.unpause(accounts.deployer);
    expect(unpauseResult).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: false });
  });
});