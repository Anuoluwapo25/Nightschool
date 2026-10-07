# Deploying to Preprod: notes

## `Invalid Transaction: Custom error: 117`

The deploy and the first `addChallenge` went through. Every transaction after
that was rejected with `RpcError: 1010: Invalid Transaction: Custom error: 117`,
including transactions from fresh processes with a fully synced wallet.

**What 117 is.** In `midnight-node`'s ledger bindings, 117 is
`MalformedError::NotNormalized`: the transaction is not in canonical form.

**Which check failed.** The ledger raises `NotNormalized` in a few places. We
dumped the balanced transaction before submission (`NIGHTSCHOOL_DUMP_TX=<file>`)
to see which one:

```
dust_actions: Some(DustActions { spends: [], registrations: [], … })
```

That is an empty DUST action, which `dust.rs` rejects outright ("non-canonical
dust actions: empty").

**Why the wallet built it.** The `addChallenge` transcript shows
`bytes_deleted: 1428`. Rewriting contract state earns a storage rebate, and
that can take the net fee to zero or below. The wallet SDK's coin selection
(`wallet-sdk-dust-wallet` 4.2.0, `computeBalancingRecipe`) then needs no
inputs, declares itself converged, and still attaches a `DustActions` with no
spends.

**Fix.** `costParameters.additionalFeeOverhead` in
[`packages/cli/src/wallet.ts`](../packages/cli/src/wallet.ts) keeps every fee
strictly positive, so at least one DUST coin is always spent. All later
transactions (three challenges, three invite batches, an enrolment and a claim)
were accepted with it in place.

**Open question.** A browser wallet (Lace) balances transactions with its own
settings. If it doesn't add a similar overhead, a learner's claim could hit the
same rejection. This hasn't been tested yet with Lace against this contract.

## Sequential transactions

Even with the fee fix, the CLI waits 20 seconds and resyncs the wallet between
transactions it sends back to back. That lets the wallet see its spent DUST
coin before it picks one for the next fee.

## Proof times

The `claim` proving key is 10 MB, and proofs return in about a second on a
local `midnightntwrk/proof-server:8.1.0`.
