/* eslint-env mocha */
/* global artifacts, contract, web3, it, beforeEach */
const hre = require("hardhat");
const { assert, expect } = require("chai");
const { expectRevert, expectEvent } = require("@openzeppelin/test-helpers");

const { impersonate } = require("../helpers/impersonate");
const constants = require("../helpers/constants");
const { web3 } = require("@openzeppelin/test-helpers/src/setup");
const { keccak256 } = require("@ethersproject/keccak256");
const ethers = hre.ethers;

describe("NFT Creation, roles and erc20 deployments", () => {
  let metadata,
    tokenERC721,
    tokenAddress,
    data,
    flags,
    factoryERC721,
    factoryERC20,
    templateERC721,
    templateERC20,
    erc20Token,
    erc20Token2;
 

  const communityFeeCollector = "0xeE9300b7961e0a01d9f0adb863C7A227A07AaD75";


  before("init contracts for each test", async () => {
    const ERC721Template = await ethers.getContractFactory("ERC721Template");
    const ERC20Template = await ethers.getContractFactory("ERC20Template");
    const ERC721Factory = await ethers.getContractFactory("ERC721Factory");
    const ERC20Factory = await ethers.getContractFactory("ERC20Factory");

    const Metadata = await ethers.getContractFactory("Metadata");

    [owner, reciever, user2, user3, user4, newOwner] = await ethers.getSigners();

    data = web3.utils.asciiToHex('SomeData');
    flags = web3.utils.asciiToHex(constants.blob[0]);
    metadata = await Metadata.deploy();
 
    templateERC20 = await ERC20Template.deploy();
    factoryERC20 = await ERC20Factory.deploy(
      templateERC20.address,
      communityFeeCollector
    );
    templateERC721 = await ERC721Template.deploy();
    factoryERC721 = await ERC721Factory.deploy(
      templateERC721.address,
      communityFeeCollector,
      factoryERC20.address
    );

  

    await metadata.setERC20Factory(factoryERC20.address);
    await factoryERC20.setERC721Factory(factoryERC721.address);

  });

  it("#1 - owner deploys a new ERC721 Contract", async () => {
    // by default connect() in ethers goes with the first address (owner in this case)
    const tx = await factoryERC721
      .deployERC721Contract(
        "NFT",
        "NFTSYMBOL",
        metadata.address,
        data,
        flags,
        1
      );
    const txReceipt = await tx.wait();

    tokenAddress = txReceipt.events[4].args[0];
    tokenERC721 = await ethers.getContractAt("ERC721Template", tokenAddress);

    assert((await tokenERC721.balanceOf(owner.address)) == 1);
  });

  it("#2 - owner is already manager and can assign or revoke roles to himself or others", async () => {
    // NFT Owner is also added as manager when deploying (first time), if transferred that doesn't apply
    assert(
      (await tokenERC721._getPermissions(owner.address)).manager == true
    );
    
    // In this test we are going to assign user2 as manager, which then adds roles and delegates user3 as store updater(725Y), erc20 deployer and metadata updater. 
    assert((await tokenERC721._getPermissions(user2.address)).manager == false);
    await tokenERC721.addManager(user2.address);
    assert((await tokenERC721._getPermissions(user2.address)).manager == true);
    
    
    assert(
      (await tokenERC721._getPermissions(user3.address)).store == false
    );
    assert(
      (await tokenERC721._getPermissions(user3.address)).deployERC20 == false
    );
    assert(
      (await tokenERC721._getPermissions(user3.address)).updateMetadata == false
    );

    await tokenERC721.connect(user2).addTo725StoreList(user3.address);
    await tokenERC721.connect(user2).addToCreateERC20List(user3.address);
    await tokenERC721.connect(user2).addToMetadataList(user3.address);

    assert(
      (await tokenERC721._getPermissions(user3.address)).store == true
    );
    assert(
      (await tokenERC721._getPermissions(user3.address)).deployERC20 == true
    );
    assert(
      (await tokenERC721._getPermissions(user3.address)).updateMetadata == true
    );
  });

  it("#3 - user3 deploys a new erc20DT, assigning himself as minter", async () => {
    const trxERC20 = await tokenERC721
    .connect(user3)
    .createERC20("ERC20DT1", "ERC20DT1Symbol", web3.utils.toWei("10"), 1, user3.address);
      const trxReceiptERC20 = await trxERC20.wait();
    erc20Address = trxReceiptERC20.events[3].args.erc20Address;

    erc20Token = await ethers.getContractAt("ERC20Template", erc20Address);
    assert((await erc20Token.permissions(user3.address)).minter == true);
    
    
  });

  it("#4 - user3 mints new erc20 token to user4", async () => {
    await erc20Token.connect(user3).mint(user4.address, web3.utils.toWei("2"));

    assert(
      (await erc20Token.balanceOf(user4.address)) == web3.utils.toWei("2")
    );
  });

  it("#5 - user3 deploys a new erc20DT, assigning user4 as minter", async () => {
    const trxERC20 = await tokenERC721
    .connect(user3)
    .createERC20("ERC20DT1", "ERC20DT1Symbol", web3.utils.toWei("10"), 1, user4.address);
      const trxReceiptERC20 = await trxERC20.wait();
    erc20Address = trxReceiptERC20.events[3].args.erc20Address;

    erc20Token2 = await ethers.getContractAt("ERC20Template", erc20Address);
    assert((await erc20Token2.permissions(user4.address)).minter == true);
  });

  it("#7 - user4 mints new erc20 token2 to user3", async () => {
    await erc20Token2.connect(user4).mint(user3.address, web3.utils.toWei("2"));

    assert(
      (await erc20Token2.balanceOf(user3.address)) == web3.utils.toWei("2")
    );
  });

  it("#8 - user3 updates the metadata for Aqua", async () => {
    const keyMetadata = web3.utils.keccak256("METADATA_KEY");
    assert(await tokenERC721.getData(keyMetadata) == data)
    let newData = web3.utils.asciiToHex('SomeNewData');
    await tokenERC721.connect(user3).updateMetadata(flags, newData);
    
    assert(await tokenERC721.getData(keyMetadata) == newData)
  });

  it("#9 - user3 (has erc20 deployer permission) updates ERC20 data (fix key)", async () => {
    const key = web3.utils.keccak256(erc20Token.address);
    const value = web3.utils.asciiToHex('SomeData')
    assert(await tokenERC721.getData(key) == '0x')
    await erc20Token.connect(user3).setData(value);
    assert(await tokenERC721.getData(key) == value)
  });

  it("#10 - user3 updates the metadata (725Y) with arbitrary keys", async () => {
    const key = web3.utils.keccak256('ARBITRARY_KEY');
    const value = web3.utils.asciiToHex('SomeData')
    
    assert(await tokenERC721.getData(key) == '0x')

    await tokenERC721.connect(user3).setNewData(key,value)

    assert(await tokenERC721.getData(key) == value)
  });

  it("#11 - owner now decides to sell and transfer the NFT, he first calls cleanPermissions, then transfer the NFT", async () => {
    // NOTE: calling cleanPermissions will remove all permissions granted to any user, even the NFT Owner which is manager by default when deploying,
    // he'll have to re-add himself as manager.
    // cleanPermissions is not a required step for transfering but highly recommended.
    
    // IMPORTANT:
    // In any case the NFT Owner will always be able to cleanPermissions if previous holder didn't.
    
    // even better, we shouldn't allow to transfer without cleaning permissions
    // minter roles permissions need to be cleaned also for each new erc20Token (we could pack all these steps)

    await erc20Token.connect(owner).cleanPermissions();
    await erc20Token2.connect(owner).cleanPermissions();
    await tokenERC721.connect(owner).cleanPermissions();

    assert((await tokenERC721.ownerOf(1)) == owner.address);

    await tokenERC721
      .connect(owner)
      .transferFrom(owner.address, newOwner.address, 1);

    assert((await tokenERC721.balanceOf(owner.address)) == 0);

    assert((await tokenERC721.ownerOf(1)) == newOwner.address);
  });

  it("#12 - owner is not NFT owner anymore, nor has any other role, neither older users", async () => {
    await expectRevert(
      tokenERC721
        .connect(user2)
        .createERC20("ERC20DT2", "ERC20DT2Symbol", web3.utils.toWei("10"), 1, user2.address),
      "ERC721Template: NOT MINTER_ROLE"
    );

    await expectRevert(
      erc20Token.connect(user2).mint(user2.address, web3.utils.toWei("1")),
      "ERC20Template: NOT MINTER"
    );
  });

  it("#13 - newOwner now owns the NFT but still has no roles, so transactions revert", async () => {
    await expectRevert(
      tokenERC721
        .connect(newOwner)
        .createERC20("ERC20DT2", "ERC20DT2Symbol", web3.utils.toWei("10"), 1, user2.address),
      "ERC721Template: NOT MINTER_ROLE"
    );

    await expectRevert(
      erc20Token.connect(newOwner).mint(user2.address, web3.utils.toWei("1")),
      "ERC20Template: NOT MINTER"
    );

    await expectRevert(
      erc20Token.connect(user4).mint(user2.address, web3.utils.toWei("1")),
      "ERC20Template: NOT MINTER"
    );
  });

 

  // NOTE: each time an NFT is transferred (sold), we'll have to clean permissions at the 721 level, plus at erc20 level for each v4 DT deployed.
  


});