import { createRequire } from "node:module";
import { expect } from "chai";

type AbiInput = {
  type: string;
};

type AbiEntry = {
  type: string;
  name?: string;
  inputs?: AbiInput[];
  outputs?: AbiInput[];
};

const requireTokenOps = createRequire(__filename);
const { confidentialVestingManagerAbi } = requireTokenOps("@tokenops/sdk/fhe-vesting") as {
  confidentialVestingManagerAbi: AbiEntry[];
};

describe("TokenOps SDK integration surface", function () {
  function functionAbi(name: string) {
    return confidentialVestingManagerAbi.find((entry) => entry.type === "function" && entry.name === name);
  }

  function requireFunctionAbi(name: string) {
    const abi = functionAbi(name);
    expect(abi).to.not.equal(undefined);
    expect(abi?.inputs).to.not.equal(undefined);
    expect(abi?.outputs).to.not.equal(undefined);
    return abi as AbiEntry & { inputs: AbiInput[]; outputs: AbiInput[] };
  }

  it("exposes the vesting manager calls required by TokenOpsVestingAdapter", function () {
    const getVestingInfo = requireFunctionAbi("getVestingInfo");
    expect(getVestingInfo.inputs).to.have.length(1);
    expect(getVestingInfo.inputs[0]?.type).to.equal("bytes32");
    expect(getVestingInfo.outputs).to.have.length(1);
    expect(getVestingInfo.outputs[0]?.type).to.equal("tuple");

    const pendingTransfer = requireFunctionAbi("getPendingVestingTransfer");
    expect(pendingTransfer.inputs.map((input) => input.type)).to.deep.equal(["bytes32"]);
    expect(pendingTransfer.outputs.map((output) => output.type)).to.deep.equal(["address", "uint48", "uint48"]);

    const initiateTransfer = requireFunctionAbi("initiateVestingTransfer");
    expect(initiateTransfer.inputs.map((input) => input.type)).to.deep.equal(["bytes32", "address", "uint48"]);

    const acceptTransfer = requireFunctionAbi("acceptVestingTransfer");
    expect(acceptTransfer.inputs.map((input) => input.type)).to.deep.equal(["bytes32"]);
  });
});
