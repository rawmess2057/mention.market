/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/mention.json`.
 */
export type Mention = {
  "address": "E6CW51RhjVAiMKJMjzfUNWDDyetqninZzRSLa4nRdZDV",
  "metadata": {
    "name": "mention",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "backWord",
      "docs": [
        "Back `word` with `amount` base units in a majority (pari-mutuel) market."
      ],
      "discriminator": [
        125,
        54,
        17,
        90,
        42,
        14,
        109,
        135
      ],
      "accounts": [
        {
          "name": "backer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "backer"
              }
            ]
          }
        },
        {
          "name": "backerAta",
          "docs": [
            "asset type and validated by the transfer CPI."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "vaultAta",
          "docs": [
            "transfer CPI when the market is USDC-denominated."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "mint",
          "docs": [
            "ATA creation on USDC markets."
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "word",
          "type": "string"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "buyBinary",
      "docs": [
        "Buy `side` (0 = YES, 1 = NO) for `cost` base units, minting at least",
        "`min_shares` shares via LMSR."
      ],
      "discriminator": [
        59,
        134,
        75,
        195,
        41,
        2,
        171,
        71
      ],
      "accounts": [
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "trader"
              }
            ]
          }
        },
        {
          "name": "traderAta",
          "docs": [
            "asset type and validated by the transfer CPI."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "vaultAta",
          "docs": [
            "transfer CPI when the market is USDC-denominated."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "mint",
          "docs": [
            "ATA creation on USDC markets."
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "cost",
          "type": "u64"
        },
        {
          "name": "minShares",
          "type": "u64"
        }
      ]
    },
    {
      "name": "challengeResolution",
      "docs": [
        "Anyone may challenge a live proposal inside the challenge window."
      ],
      "discriminator": [
        5,
        230,
        48,
        100,
        46,
        252,
        35,
        119
      ],
      "accounts": [
        {
          "name": "challenger",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "challengerAta",
          "docs": [
            "type and validated by the transfer CPI."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "vaultAta",
          "docs": [
            "CPI when the market is USDC-denominated."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "mint",
          "docs": [
            "ATA creation on USDC markets."
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "claimPayout",
      "docs": [
        "Claim a position's payout in a resolved market."
      ],
      "discriminator": [
        127,
        240,
        132,
        62,
        227,
        198,
        146,
        133
      ],
      "accounts": [
        {
          "name": "claimant",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "claimant"
              }
            ]
          }
        },
        {
          "name": "claimantAta",
          "docs": [
            "asset type and validated by the transfer CPI."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "vaultAta",
          "docs": [
            "CPI when the market is USDC-denominated."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "mint",
          "docs": [
            "ATA creation on USDC markets."
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createMarket",
      "docs": [
        "Create a binary (LMSR) or majority (pari-mutuel) market plus its vault."
      ],
      "discriminator": [
        103,
        226,
        97,
        235,
        200,
        188,
        251,
        254
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "title",
          "type": "string"
        },
        {
          "name": "event",
          "type": "string"
        },
        {
          "name": "vertical",
          "type": {
            "defined": {
              "name": "vertical"
            }
          }
        },
        {
          "name": "marketType",
          "type": {
            "defined": {
              "name": "marketType"
            }
          }
        },
        {
          "name": "asset",
          "type": {
            "defined": {
              "name": "assetKind"
            }
          }
        },
        {
          "name": "b",
          "type": "u64"
        },
        {
          "name": "words",
          "type": {
            "vec": "string"
          }
        },
        {
          "name": "endTime",
          "type": "i64"
        },
        {
          "name": "creatorFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "finalizeResolution",
      "docs": [
        "Finalize an undisputed proposal after the window elapses."
      ],
      "discriminator": [
        191,
        74,
        94,
        214,
        45,
        150,
        152,
        125
      ],
      "accounts": [
        {
          "name": "finalizer",
          "docs": [
            "Permissionless; pays rent if a refund ATA must be created."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "proposerAta",
          "docs": [
            "asset type and validated by the transfer CPI."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "proposerAccount",
          "writable": true,
          "optional": true
        },
        {
          "name": "vaultAta",
          "docs": [
            "CPI when the market is USDC-denominated."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "mint",
          "docs": [
            "ATA creation on USDC markets."
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeConfig",
      "docs": [
        "One-time program setup: authority, trusted resolver, USDC mint, fee."
      ],
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "resolver"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "feeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "lockMarket",
      "docs": [
        "Permissionlessly lock a market after its end time."
      ],
      "discriminator": [
        107,
        8,
        184,
        91,
        223,
        13,
        180,
        38
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.id",
                "account": "market"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "proposeResolution",
      "docs": [
        "Resolver proposes the winning outcome with a bond and an evidence hash."
      ],
      "discriminator": [
        19,
        68,
        181,
        23,
        194,
        146,
        152,
        252
      ],
      "accounts": [
        {
          "name": "resolver",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "resolverAta",
          "docs": [
            "and validated by the transfer CPI."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "vaultAta",
          "docs": [
            "CPI when the market is USDC-denominated."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "mint",
          "docs": [
            "ATA creation on USDC markets."
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "outcome",
          "type": "string"
        },
        {
          "name": "confidence",
          "type": "u8"
        },
        {
          "name": "evidenceHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "sellBinary",
      "docs": [
        "Sell `shares` of `side` back to the AMM for at least `min_proceeds`."
      ],
      "discriminator": [
        133,
        167,
        88,
        229,
        240,
        3,
        11,
        147
      ],
      "accounts": [
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "trader"
              }
            ]
          }
        },
        {
          "name": "traderAta",
          "docs": [
            "per asset type and validated by the transfer CPI."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "vaultAta",
          "docs": [
            "Vault USDC ATA. USDC markets only."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "mint",
          "docs": [
            "ATA creation on USDC markets."
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "shares",
          "type": "u64"
        },
        {
          "name": "minProceeds",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    },
    {
      "name": "position",
      "discriminator": [
        170,
        188,
        143,
        228,
        122,
        64,
        247,
        208
      ]
    },
    {
      "name": "vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    }
  ],
  "events": [
    {
      "name": "marketCreated",
      "discriminator": [
        88,
        184,
        130,
        231,
        226,
        84,
        6,
        58
      ]
    },
    {
      "name": "marketResolved",
      "discriminator": [
        89,
        67,
        230,
        95,
        143,
        106,
        199,
        202
      ]
    },
    {
      "name": "payoutClaimed",
      "discriminator": [
        200,
        39,
        105,
        112,
        116,
        63,
        58,
        149
      ]
    },
    {
      "name": "proposalChallenged",
      "discriminator": [
        96,
        25,
        112,
        63,
        55,
        222,
        239,
        40
      ]
    },
    {
      "name": "proposalProposed",
      "discriminator": [
        89,
        41,
        20,
        64,
        110,
        68,
        219,
        232
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "paused",
      "msg": "Program is paused"
    },
    {
      "code": 6001,
      "name": "unauthorized",
      "msg": "Signer is not authorized for this action"
    },
    {
      "code": 6002,
      "name": "invalidFeeBps",
      "msg": "Fee basis points exceed the maximum"
    },
    {
      "code": 6003,
      "name": "invalidEndTime",
      "msg": "Invalid end time"
    },
    {
      "code": 6004,
      "name": "invalidMarket",
      "msg": "Invalid market parameters"
    },
    {
      "code": 6005,
      "name": "marketNotOpen",
      "msg": "Market is not open"
    },
    {
      "code": 6006,
      "name": "marketNotEnded",
      "msg": "Market has not ended yet"
    },
    {
      "code": 6007,
      "name": "tooManyWords",
      "msg": "Too many words for this market"
    },
    {
      "code": 6008,
      "name": "wordTooLong",
      "msg": "Word label is too long"
    },
    {
      "code": 6009,
      "name": "titleTooLong",
      "msg": "Title or event name is too long"
    },
    {
      "code": 6010,
      "name": "outcomeTooLong",
      "msg": "Outcome label is too long"
    },
    {
      "code": 6011,
      "name": "invalidTokenAccount",
      "msg": "Token account data is invalid"
    },
    {
      "code": 6012,
      "name": "insufficientAmount",
      "msg": "Insufficient funds for this action"
    },
    {
      "code": 6013,
      "name": "notBinary",
      "msg": "Market is not a binary (LMSR) market"
    },
    {
      "code": 6014,
      "name": "notMajority",
      "msg": "Market is not a majority (pari-mutuel) market"
    },
    {
      "code": 6015,
      "name": "unknownWord",
      "msg": "Word is not a valid outcome in this market"
    },
    {
      "code": 6016,
      "name": "claimed",
      "msg": "Position must be zero to claim"
    },
    {
      "code": 6017,
      "name": "noWinningShares",
      "msg": "No winning shares held"
    },
    {
      "code": 6018,
      "name": "notResolved",
      "msg": "Market has not resolved yet"
    },
    {
      "code": 6019,
      "name": "marketNotLocked",
      "msg": "Market must be locked before a proposal"
    },
    {
      "code": 6020,
      "name": "alreadyResolving",
      "msg": "Market is already resolving"
    },
    {
      "code": 6021,
      "name": "noPendingProposal",
      "msg": "No pending resolution proposal"
    },
    {
      "code": 6022,
      "name": "windowNotOpen",
      "msg": "Challenge window is not open"
    },
    {
      "code": 6023,
      "name": "invalidResolution",
      "msg": "Outcome or evidence is invalid"
    },
    {
      "code": 6024,
      "name": "slippageTooHigh",
      "msg": "Exit price moved beyond slippage tolerance"
    }
  ],
  "types": [
    {
      "name": "assetKind",
      "docs": [
        "Currency a market is denominated in. USDC markets settle through an SPL",
        "token vault; SOL markets settle through the `Vault` PDA's lamports."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "usdc"
          },
          {
            "name": "sol"
          }
        ]
      }
    },
    {
      "name": "config",
      "docs": [
        "Global program configuration (one per deployment)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "resolver",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "market",
      "docs": [
        "A prediction market. Binary markets price YES/NO with LMSR; majority markets",
        "are pari-mutuel word races."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "title",
            "type": "string"
          },
          {
            "name": "event",
            "type": "string"
          },
          {
            "name": "vertical",
            "type": {
              "defined": {
                "name": "vertical"
              }
            }
          },
          {
            "name": "asset",
            "type": {
              "defined": {
                "name": "assetKind"
              }
            }
          },
          {
            "name": "marketType",
            "type": {
              "defined": {
                "name": "marketType"
              }
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "marketStatus"
              }
            }
          },
          {
            "name": "b",
            "docs": [
              "LMSR liquidity parameter (binary markets), in base units."
            ],
            "type": "u64"
          },
          {
            "name": "yesShares",
            "type": "u64"
          },
          {
            "name": "noShares",
            "type": "u64"
          },
          {
            "name": "yesCost",
            "docs": [
              "Cumulative cost basis of YES/NO shares — drives LMSR solvency accounting."
            ],
            "type": "u64"
          },
          {
            "name": "noCost",
            "type": "u64"
          },
          {
            "name": "words",
            "type": {
              "vec": {
                "defined": {
                  "name": "wordPool"
                }
              }
            }
          },
          {
            "name": "totalPool",
            "docs": [
              "Total pari-mutuel pot across all words, in base units."
            ],
            "type": "u64"
          },
          {
            "name": "volume",
            "type": "u64"
          },
          {
            "name": "traders",
            "type": "u32"
          },
          {
            "name": "creatorFeeBps",
            "type": "u16"
          },
          {
            "name": "endTime",
            "type": "i64"
          },
          {
            "name": "winningOutcome",
            "docs": [
              "Empty until resolved. \"yes\" | \"no\" for binary, a word for majority."
            ],
            "type": "string"
          },
          {
            "name": "confidence",
            "type": "u8"
          },
          {
            "name": "bond",
            "type": "u64"
          },
          {
            "name": "evidenceHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "proposedAt",
            "type": "i64"
          },
          {
            "name": "challengeDeadline",
            "type": "i64"
          },
          {
            "name": "resolvedAt",
            "type": "i64"
          },
          {
            "name": "proposer",
            "docs": [
              "Resolver pubkey behind the current proposal; the bond refunds here on",
              "finalize (via their ATA for USDC markets, lamports for SOL markets)."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "marketCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "marketResolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "outcome",
            "type": "string"
          },
          {
            "name": "confidence",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "marketStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "locked"
          },
          {
            "name": "resolving"
          },
          {
            "name": "resolved"
          }
        ]
      }
    },
    {
      "name": "marketType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "binary"
          },
          {
            "name": "majority"
          }
        ]
      }
    },
    {
      "name": "payoutClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "claimant",
            "type": "pubkey"
          },
          {
            "name": "payout",
            "type": "u64"
          },
          {
            "name": "outcome",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "position",
      "docs": [
        "A wallet's holdings in a single market."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "yesShares",
            "type": "u64"
          },
          {
            "name": "noShares",
            "type": "u64"
          },
          {
            "name": "yesCost",
            "type": "u64"
          },
          {
            "name": "noCost",
            "type": "u64"
          },
          {
            "name": "wordBacks",
            "type": {
              "vec": {
                "defined": {
                  "name": "wordBack"
                }
              }
            }
          },
          {
            "name": "claimed",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "proposalChallenged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "challenger",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "proposalProposed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "proposer",
            "type": "pubkey"
          },
          {
            "name": "outcome",
            "type": "string"
          },
          {
            "name": "deadline",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "vault",
      "docs": [
        "Per-market escrow. Holds SOL directly; owns the USDC ATA when `asset` is USDC."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "type": {
              "defined": {
                "name": "assetKind"
              }
            }
          },
          {
            "name": "mint",
            "docs": [
              "USDC mint for token markets, or the system program id for SOL markets."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "vertical",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "streams"
          },
          {
            "name": "sports"
          },
          {
            "name": "earnings"
          },
          {
            "name": "politics"
          },
          {
            "name": "podcasts"
          }
        ]
      }
    },
    {
      "name": "wordBack",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "word",
            "type": "string"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "wordPool",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "word",
            "type": "string"
          },
          {
            "name": "pool",
            "type": "u64"
          },
          {
            "name": "bettors",
            "type": "u32"
          }
        ]
      }
    }
  ]
};
