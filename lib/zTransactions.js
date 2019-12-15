var bitcoin = require('bitgo-utxo-lib');
var util = require('./util.js');

var scriptCompile = function(addrHash) {
    return bitcoin.script.compile([
        bitcoin.opcodes.OP_DUP,
        bitcoin.opcodes.OP_HASH160,
        addrHash,
        bitcoin.opcodes.OP_EQUALVERIFY,
        bitcoin.opcodes.OP_CHECKSIG
    ]);
};

var scriptFoundersCompile = function(address) {
    return bitcoin.script.compile([
        bitcoin.opcodes.OP_HASH160,
        address,
        bitcoin.opcodes.OP_EQUAL
    ]);
};

// public members
var txHash
exports.txHash = function() {
    return txHash;
};

exports.createGeneration = function (rpcData, blockReward, feeReward, recipients, poolAddress, coinbase, coin, masternodeReward, masternodePayee, masternodePayment, zelnodeBasicAddress, zelnodeBasicAmount, zelnodeSuperAddress, zelnodeSuperAmount, zelnodeBamfAddress, zelnodeBamfAmount) {
    if (coin.burnFees) {
        feeReward = 0
    }

    var poolAddrHash = bitcoin.address.fromBase58Check(poolAddress).hash;

    var network = coin.network;
    var txb = new bitcoin.TransactionBuilder(network);

    // Set sapling or overwinter to either true OR block height to activate.
    // NOTE: if both are set, sapling will be used.
    if (coin.sapling === true || (typeof coin.sapling === 'number' && coin.sapling <= rpcData.height)) {
        txb.setVersion(bitcoin.Transaction.ZCASH_SAPLING_VERSION);
    } else if (coin.overwinter === true || (typeof coin.overwinter === 'number' && coin.overwinter <= rpcData.height)) {
        txb.setVersion(bitcoin.Transaction.ZCASH_OVERWINTER_VERSION);
    }

    var payZelNodeRewards = false;
    if (coin.payZelNodes === true || (typeof coin.payZelNodes === 'number' && coin.payZelNodes <= Date.now() / 1000 )) {
        payZelNodeRewards = true;
    }

    // input for coinbase tx
    var blockHeightSerial = (rpcData.height.toString(16).length % 2 === 0 ? '' : '0') + rpcData.height.toString(16);

    var height = Math.ceil((rpcData.height << 1).toString(2).length / 8);
    var lengthDiff = blockHeightSerial.length / 2 - height;
    for (var i = 0; i < lengthDiff; i++) {
        blockHeightSerial = blockHeightSerial + '00'
    }

    var length = '0' + height;
    var serializedBlockHeight = Buffer.concat([
        Buffer.from(length, 'hex'),
        util.reverseBuffer(Buffer.from(blockHeightSerial, 'hex')),
        Buffer.from('00', 'hex') // OP_0
    ]);

    if(!coinbase) coinbase = 'nodeStratum';
    var scriptSigPart2 = util.serializeString('/' + coinbase + '/');

    txb.addInput(Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex'),
        4294967295,
        4294967295,
        Buffer.concat([
            serializedBlockHeight,
            scriptSigPart2
        ])
    );

    // calculate total fees
    var feePercent = recipients.reduce(function(accumulator, recipient) {
        return accumulator + recipient.percent;
    }, 0);

    // TODO: This sorely needs to be updated and simplified
    if ((masternodePayment === false || masternodePayment === undefined) && payZelNodeRewards === false && !rpcData.coinbase_required_outputs) {
        // txs with founders reward
        // This section is for ZEN + other coins
        if (coin.payFoundersReward === true && ((coin.maxFoundersRewardBlockHeight >= rpcData.height || coin.treasuryRewardStartBlockHeight || coin.treasuryRewardUpdateStartBlockHeight || coin.treasuryReward20pctUpdateStartBlockHeight) || coin.payAllFounders === true)) {
            // treasury reward or Super Nodes treasury update?
            if ((coin.treasuryRewardUpdateStartBlockHeight || coin.treasuryReward20pctUpdateStartBlockHeight) && rpcData.height >= (coin.treasuryRewardUpdateStartBlockHeight || coin.treasuryReward20pctUpdateStartBlockHeight)) {
                var percentTreasuryReward = coin.percentTreasuryUpdateReward;
                var treasuryRewardStartBlockHeight = coin.treasuryRewardUpdateStartBlockHeight;
                // Horizen treasury reward 20% update
                if (coin.treasuryReward20pctUpdateStartBlockHeight && rpcData.height >= coin.treasuryReward20pctUpdateStartBlockHeight) {
                    percentTreasuryReward = coin.percentTreasury20pctUpdateReward;
                    treasuryRewardStartBlockHeight = coin.treasuryReward20pctUpdateStartBlockHeight;
                }

                // treasury reward
                var indexCF = parseInt(Math.floor(((rpcData.height - treasuryRewardStartBlockHeight) / coin.treasuryRewardUpdateAddressChangeInterval) % coin.vTreasuryRewardUpdateAddress.length));
                var foundersAddrHash = bitcoin.address.fromBase58Check(coin.vTreasuryRewardUpdateAddress[indexCF]).hash;

                // Secure Nodes reward
                var indexSN = parseInt(Math.floor(((rpcData.height - coin.treasuryRewardUpdateStartBlockHeight) / coin.treasuryRewardUpdateAddressChangeInterval) % coin.vSecureNodesRewardAddress.length));
                var secureNodesAddrHash = bitcoin.address.fromBase58Check(coin.vSecureNodesRewardAddress[indexSN]).hash;

                // Super Nodes reward
                var indexXN = parseInt(Math.floor(((rpcData.height - coin.treasuryRewardUpdateStartBlockHeight) / coin.treasuryRewardUpdateAddressChangeInterval) % coin.vSuperNodesRewardAddress.length));
                var superNodesAddrHash = bitcoin.address.fromBase58Check(coin.vSuperNodesRewardAddress[indexXN]).hash;

                // pool t-addr
                txb.addOutput(
                    scriptCompile(poolAddrHash),
                    Math.round(blockReward.total * (1 - (percentTreasuryReward + coin.percentSecureNodesReward + coin.percentSuperNodesReward + feePercent) / 100)) + feeReward
                );

                // treasury t-addr
                txb.addOutput(
                    scriptFoundersCompile(foundersAddrHash),
                    Math.round(blockReward.total * (percentTreasuryReward / 100))
                );

                // Secure Nodes t-addr
                txb.addOutput(
                    scriptFoundersCompile(secureNodesAddrHash),
                    Math.round(blockReward.total * (coin.percentSecureNodesReward / 100))
                );

                // Super Nodes t-addr
                txb.addOutput(
                    scriptFoundersCompile(superNodesAddrHash),
                    Math.round(blockReward.total * (coin.percentSuperNodesReward / 100))
                );

                // founders or treasury reward?
            } else if (coin.treasuryRewardStartBlockHeight && rpcData.height >= coin.treasuryRewardStartBlockHeight) {
                // treasury reward
                var index = parseInt(Math.floor(((rpcData.height - coin.treasuryRewardStartBlockHeight) / coin.treasuryRewardAddressChangeInterval) % coin.vTreasuryRewardAddress.length));
                var foundersAddrHash = bitcoin.address.fromBase58Check(coin.vTreasuryRewardAddress[index]).hash;

                // pool t-addr
                txb.addOutput(
                    scriptCompile(poolAddrHash),
                    Math.round(blockReward.total * (1 - (coin.percentTreasuryReward + feePercent) / 100)) + feeReward
                );

                // treasury t-addr
                txb.addOutput(
                    scriptFoundersCompile(foundersAddrHash),
                    Math.round(blockReward.total * (coin.percentTreasuryReward / 100))
                );
            } else if (coin.payAllFounders === true) {
                // SafeCash / Genx
                // Calculate and do the pool fee deduction
                var poolFeeDeductionTotalPercent = recipients.reduce(function (accumulator, recipient) {
                    return accumulator + recipient.percent;
                }, 0);

                var poolDeductionAmount = Math.round(blockReward.total * (poolFeeDeductionTotalPercent / 100));

                txb.addOutput(
                    scriptCompile(poolAddrHash),
                    blockReward.miner - poolDeductionAmount + feeReward
                );

                // Infrastructure
                if (rpcData.infrastructure && rpcData.infrastructure > 0) {
                    var infrastructureAddrHash = bitcoin.address.fromBase58Check(coin.infrastructureAddresses[0]).hash;
                    txb.addOutput(scriptFoundersCompile(infrastructureAddrHash), blockReward.infrastructure);
                }
                // Giveaways
                if (rpcData.giveaways && rpcData.giveaways > 0) {
                    var giveawaysAddrHash = bitcoin.address.fromBase58Check(coin.giveawayAddresses[0]).hash;
                    txb.addOutput(scriptFoundersCompile(giveawaysAddrHash), blockReward.giveaways);
                }
                // Add founders
                if (rpcData.founders && rpcData.founders.length > 0) {
                    // loop through founders and add them to our coinbase transaction
                    rpcData.founders.forEach(function (founderItem) {
                        txb.addOutput(
                            Buffer.from(founderItem.script, 'hex'),
                            founderItem.amount
                        );
                    });
                }
                // Add masternode payments
                if (rpcData.masternodes && rpcData.masternodes.length > 0) {
                    // loop through masternodes and add them to our coinbase transaction
                    rpcData.masternodes.forEach(function (masternodeItem) {
                        txb.addOutput(
                            Buffer.from(masternodeItem.script, 'hex'),
                            masternodeItem.amount
                        );
                    });
                }
                // Add governance payments
                if (rpcData.governanceblock && rpcData.governanceblock.length > 0) {
                    // loop through governance items and add them to our coinbase transaction
                    rpcData.governanceblock.forEach(function (governanceItem) {
                        txb.addOutput(
                            Buffer.from(governanceItem.script, 'hex'),
                            governanceItem.amount
                        );
                    });
                }
            } else if(Array.isArray(coin.vYcashFoundersRewardAddress)) {
                // Founders reward for Ycash
                var foundersAddrHash = bitcoin.address.fromBase58Check(rpcData.coinbasetxn.foundersaddress).hash;

                // pool t-addr
                txb.addOutput(
                    scriptCompile(poolAddrHash),
                    Math.round(blockReward.total * (1 - (coin.percentFoundersReward + feePercent) / 100)) + feeReward
                );

                // founders t-addr
                txb.addOutput(
                    scriptCompile(foundersAddrHash),
                    Math.round(blockReward.total * (coin.percentFoundersReward / 100))
                );
            } else {
                // founders reward
                var index = parseInt(Math.floor(rpcData.height / coin.foundersRewardAddressChangeInterval));
                var foundersAddrHash = bitcoin.address.fromBase58Check(coin.vFoundersRewardAddress[index]).hash;

                // pool t-addr
                txb.addOutput(
                    scriptCompile(poolAddrHash),
                    Math.round(blockReward.total * (1 - (coin.percentFoundersReward + feePercent) / 100)) + feeReward
                );

                // founders t-addr
                txb.addOutput(
                    scriptFoundersCompile(foundersAddrHash),
                    Math.round(blockReward.total * (coin.percentFoundersReward / 100))
                );
            }
            // no founders rewards :)
        } else {
            // pool t-addr
            txb.addOutput(
                scriptCompile(poolAddrHash),
                Math.round(blockReward.total * (1 - (feePercent / 100))) + feeReward
            );
        }
    } else if (payZelNodeRewards === false && rpcData.coinbase_required_outputs && rpcData.coinbase_required_outputs.length) {
        // This section is for ANON (Anonymous Bitcoin)
        // ANON getblocktemplate provides an array of objects
        // (coinbase_required_outputs) it contains all the required coinbase
        // outputs (masternode, developement fund, superblocks) each object has
        // the following keys: amount, script (hex), type. 'type' provides
        // short info about the purpose of the output for example 'masternode',
        // 'development' or 'superblock'

        // keep track of total the amount of all outputs (except superblock) in coinbase_required_outputs array
        var required_outputs_total = 0;

        // loop through coinbase_required_outputs and add them to our coinbase transaction
        rpcData.coinbase_required_outputs.forEach(function(output) {
            if (output.type !== "superblock") {
                required_outputs_total += output.amount;
            }

            txb.addOutput(
                Buffer.from(output.script, 'hex'),
                output.amount
            );
        });

        // we want to calculate pool fee using miner reward only
        blockReward.total -= required_outputs_total;

        //now pay to the pool address
        txb.addOutput(
            scriptCompile(poolAddrHash),
            (blockReward.total * (1 - feePercent / 100) + feeReward)
        );
    } else if (payZelNodeRewards === false) {
        var masternodeAddrHash = masternodePayee ? bitcoin.address.fromBase58Check(masternodePayee).hash : null;

        // This section is for SnowGem
        if (rpcData.founderAddress) {
            // founders reward
            var founderAddrHash = bitcoin.address.fromBase58Check(rpcData.founderAddress).hash;
            var treasuryReward = rpcData.treasuryReward ? rpcData.treasuryReward : 0;

            // pool t-addr
            txb.addOutput(
                scriptCompile(poolAddrHash),
                Math.round(blockReward.total * (1 - rpcData.founderReward / blockReward.total - feePercent / 100)) + feeReward - masternodeReward - treasuryReward
            );

            // founders t-addr
            txb.addOutput(
                scriptFoundersCompile(founderAddrHash),
                Math.round(rpcData.founderReward)
            );

            //masternode reward
            txb.addOutput(
                scriptCompile(masternodeAddrHash),
                Math.round(masternodeReward)
            );

            if (rpcData.treasuryAddress) {
                var treasuryAddrHash = bitcoin.address.fromBase58Check(rpcData.treasuryAddress).hash;
                //treasury tx
                txb.addOutput(
                    scriptFoundersCompile(treasuryAddrHash),
                    Math.round(treasuryReward)
                );
            }
        }
        //end SnowGem

        // start Vidulum
        else if(coin.VRSEnabled && rpcData.vrsAddress && rpcData.height >= coin.VRSBlock) {
            // Vidulum Reward System
            var vrsAddrHash = bitcoin.address.fromBase58Check(rpcData.vrsAddress).hash;
            
            // this prevents NaN error
            feeReward = feeReward || 0;
            feePercent = feePercent || 0;
            masternodeReward = masternodeReward || 0;

            // pool t-addr
            txb.addOutput(
                scriptCompile(poolAddrHash),
                Math.round(blockReward.total * (1 - rpcData.vrsReward / blockReward.total - feePercent / 100)) + feeReward - masternodeReward
            );

            // Vidulum Reward System t-addr
            txb.addOutput(
                scriptFoundersCompile(vrsAddrHash),
                Math.round(rpcData.vrsReward)
            );

            //masternode reward
            txb.addOutput(
                scriptCompile(masternodeAddrHash),
                Math.round(masternodeReward)
            );
        }
        //end Vidulum

        else
        {
            // txs with founders reward
            if (coin.payFoundersReward === true && (coin.maxFoundersRewardBlockHeight >= rpcData.height || coin.treasuryRewardStartBlockHeight)) {
                // founders or treasury reward?
                if (coin.treasuryRewardStartBlockHeight && rpcData.height >= coin.treasuryRewardStartBlockHeight) {
                    // treasury reward
                    var index = parseInt(Math.floor(((rpcData.height - coin.treasuryRewardStartBlockHeight) / coin.treasuryRewardAddressChangeInterval) % coin.vTreasuryRewardAddress.length));
                    var foundersAddrHash = bitcoin.address.fromBase58Check(coin.vTreasuryRewardAddress[index]).hash;

                    // pool t-addr
                    txb.addOutput(
                        scriptCompile(poolAddrHash),
                        Math.round(blockReward.total * (1 - (coin.percentTreasuryReward + feePercent) / 100)) + feeReward - masternodeReward
                    );

                    // treasury t-addr
                    txb.addOutput(
                        scriptFoundersCompile(foundersAddrHash),
                        Math.round(blockReward.total * (coin.percentTreasuryReward / 100))
                    );

                    //masternode reward
                    txb.addOutput(
                        scriptCompile(masternodeAddrHash),
                        Math.round(masternodeReward)
                    );
                } else {
                    // founders reward
                    var index = parseInt(Math.floor(rpcData.height / coin.foundersRewardAddressChangeInterval));
                    var foundersAddrHash = bitcoin.address.fromBase58Check(coin.vFoundersRewardAddress[index]).hash;

                    // pool t-addr
                    txb.addOutput(
                        scriptCompile(poolAddrHash),
                        Math.round(blockReward.total * (1 - (coin.percentFoundersReward + feePercent) / 100)) + feeReward - masternodeReward
                    );

                    // founders t-addr
                    txb.addOutput(
                        scriptFoundersCompile(foundersAddrHash),
                        Math.round(blockReward.total * (coin.percentFoundersReward / 100))
                    );

                    //masternode reward
                    txb.addOutput(
                        scriptCompile(masternodeAddrHash),
                        Math.round(masternodeReward)
                    );
                }
                // no founders rewards :)
            } else {
                // Note: For ANON coin, it enters this code when fullnode doesn't
                // return any masternode payee This should never happen on mainnet,
                // since there are plenty of masternodes. But, it is possible on
                // ANON testnet, since there are not so many masternodes.

                // this prevents NaN error
                feeReward = feeReward || 0;
                feePercent = feePercent || 0;
                masternodeReward = masternodeReward || 0;

                // pool t-addr
                txb.addOutput(
                    scriptCompile(poolAddrHash),
                    Math.round(blockReward.total * (1 - (feePercent / 100))) + feeReward - masternodeReward
                );

                // masternode reward
                // what if there is no masternode winner?
                if (masternodeAddrHash) {
                    txb.addOutput(
                        scriptCompile(masternodeAddrHash),
                        Math.round(masternodeReward)
                    );
                }
            }
        }
    } else {
        // case for ZelCash
        var zelnodeBasicAddrHash = zelnodeBasicAddress ? bitcoin.address.fromBase58Check(zelnodeBasicAddress).hash : null;
        var zelnodeSuperAddrHash = zelnodeSuperAddress ? bitcoin.address.fromBase58Check(zelnodeSuperAddress).hash : null;
        var zelnodeBamfAddrHash = zelnodeBamfAddress ? bitcoin.address.fromBase58Check(zelnodeBamfAddress).hash : null;

        // pool t-addr
        txb.addOutput(
            scriptCompile(poolAddrHash),
            Math.round(blockReward.total * (1 - (feePercent / 100))) + feeReward - zelnodeBasicAmount - zelnodeSuperAmount - zelnodeBamfAmount
        );

        // zelnode basic reward
        if (zelnodeBasicAddrHash != null) {
            txb.addOutput(
                scriptCompile(zelnodeBasicAddrHash),
                Math.round(zelnodeBasicAmount)
            );
        }

        // zelnode super reward
        if (zelnodeSuperAddrHash != null) {
            txb.addOutput(
                scriptCompile(zelnodeSuperAddrHash),
                Math.round(zelnodeSuperAmount)
            );
        }

        // zelnode bamf reward
        if (zelnodeBamfAddrHash != null) {
            txb.addOutput(
                scriptCompile(zelnodeBamfAddrHash),
                Math.round(zelnodeBamfAmount)
            );
        }
    }

    // Segwit support
    if (rpcData.default_witness_commitment !== undefined) {
        txb.addOutput(Buffer.from(rpcData.default_witness_commitment, 'hex'), 0);
    }

    // pool fee recipients t-addr
    if (recipients.length > 0 && recipients[0].address != '') {
        recipients.forEach(function(recipient) {
            txb.addOutput(
                scriptCompile(bitcoin.address.fromBase58Check(recipient.address).hash),
                Math.round(blockReward.total * (recipient.percent / 100))
            );
        });
    }

    var tx = txb.build();

    txHex = tx.toHex();

    // assign
    txHash = tx.getHash().toString('hex');

    return txHex;
}

exports.getFees = function(feeArray) {
    return feeArray.reduce(function(accumulator, value) {
        return accumulator + Number(value.fee);
    }, Number());
}

