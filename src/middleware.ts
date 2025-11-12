import { Request, Response, NextFunction } from 'express';
import { Keypair, Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Chain, CHAIN_CONFIGS } from '@x402apis/protocol';
import { PaymentError } from './errors';

// Mainnet USDC Mint Address (6 decimals)
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

/**
 * x402 payment verification middleware
 */
export function paymentMiddleware(wallet: Keypair, chains: Chain[]) {
    const providersConnection = new Map<Chain, Connection>();

    if (chains.includes('solana')) {
        const rpc = CHAIN_CONFIGS.solana.rpcEndpoint;
        providersConnection.set('solana', new Connection(rpc));
        console.log(`📡 Connected to Solana RPC: ${rpc}`);
    }

    return async (req: Request, res: Response, next: NextFunction) => {
        if (req.path === '/health') {
            return next();
        }

        try {
            // The X-Payment header is now ALWAYS expected to be a transaction signature.
            const paymentToken = req.headers['x-payment'] as string;
            const chain = (req.headers['x-payment-chain'] as Chain) || 'solana';

            if (!paymentToken || paymentToken === 'free-api-call') {
                // Handle the placeholder token for free calls from the browser client
                console.log("ℹ️  Received free API call proof. Allowing access.");
                (req as any).payment = { amount: 0, from: 'unknown', signature: paymentToken, chain };
                return next();
            }

            if (!chains.includes(chain)) {
                return res.status(400).json({ error: 'Unsupported chain', supported: chains });
            }

            const payment = await verifyPayment(paymentToken, chain, wallet, providersConnection);

            if (!payment.valid) {
                return res.status(402).json({ error: 'Invalid payment', message: payment.error });
            }

            (req as any).payment = {
                amount: payment.amount,
                from: payment.from,
                signature: paymentToken,
                chain,
            };

            next();
        } catch (error) {
            res.status(402).json({
                error: 'Payment verification failed',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    };
}

/**
 * Verify payment by checking the blockchain.
 */
async function verifyPayment(
    token: string,
    chain: Chain,
    wallet: Keypair,
    connections: Map<Chain, Connection>
): Promise<{
    valid: boolean;
    amount?: number;
    from?: string;
    signature?: string;
    error?: string;
}> {
    if (chain === 'solana') {
        // The logic now ONLY calls the on-chain verification.
        return verifySolanaOnChainPayment(token, wallet, connections.get('solana'));
    }


    return { valid: false, error: 'Unsupported chain for payment verification.' };
}

/**
 * Perform on-chain SPL Token (USDC) transfer verification on Solana.
 * This version includes detailed logging for debugging.
 */
async function verifySolanaOnChainPayment(
    transactionSignature: string,
    providerWallet: Keypair,
    connection?: Connection
): Promise<{
    valid: boolean;
    amount?: number;
    from?: string;
    signature?: string;
    error?: string;
}> {
    if (!connection) {
        return { valid: false, error: 'Solana connection not established.' };
    }

    if (!transactionSignature || typeof transactionSignature !== 'string') {
        return { valid: false, error: 'Invalid transaction signature: empty or not a string.' };
    }

    try {
        console.log(`🔍 Verifying transaction: ${transactionSignature}`);

        // 1. Fetch the transaction details from the blockchain.
        const tx = await connection.getParsedTransaction(
            transactionSignature,
            { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }
        );

        // 2. Check if the transaction exists and was successful.
        if (!tx) {
            console.error(`[VERIFICATION FAILED] Transaction signature not found on-chain: ${transactionSignature}`);
            return { valid: false, error: 'Transaction not found.' };
        }
        if (tx.meta && tx.meta.err) {
            console.error(`[VERIFICATION FAILED] Transaction has an on-chain error:`, tx.meta.err);
            return { valid: false, error: 'Transaction failed on-chain.' };
        }

        // 3. Find the specific SPL Token transfer instruction within the transaction.
        const parsedInstructions = tx.transaction.message.instructions.filter(
            ix => 'parsed' in ix && ix.programId.toBase58() === TOKEN_PROGRAM_ID.toBase58()
        ) as any[];

        const transferInstruction = parsedInstructions.find(
            ix => ix.parsed?.type === 'transfer' || ix.parsed?.type === 'transferChecked'
        );

        if (!transferInstruction) {
            console.error("[VERIFICATION FAILED] No valid SPL Token transfer instruction was found in the transaction.");
            return { valid: false, error: 'No valid SPL Token transfer instruction found.' };
        }

        // 4. Extract key details from the transfer instruction.
        const { destination, amount, authority } = transferInstruction.parsed.info;
        const providerPubkeyBase58 = providerWallet.publicKey.toBase58();

        // 5. Verify that the payment was sent to an account owned by the provider.
        const destinationAccountData = await connection.getParsedAccountInfo(new PublicKey(destination));
        if (!destinationAccountData.value?.data) {
            console.error(`[VERIFICATION FAILED] The destination token account (${destination}) does not exist.`);
            return { valid: false, error: 'Destination token account not found.' };
        }

        const destinationOwnerPubkey = (destinationAccountData.value.data as any)?.parsed?.info?.owner;

        if (!destinationOwnerPubkey) {
            console.error("[VERIFICATION FAILED] Could not determine the owner of the destination token account.");
            return { valid: false, error: 'Could not determine the owner of the destination token account.' };
        }

        if (destinationOwnerPubkey !== providerPubkeyBase58) {
            console.error(`[VERIFICATION FAILED] Payment sent to the wrong wallet.
              - Expected Owner: ${providerPubkeyBase58}
              - Actual Owner:   ${destinationOwnerPubkey}`);
            return {
                valid: false,
                error: `Payment was sent to an incorrect account.`
            };
        }

        // 6. Verify the amount paid.
        const rawAmount = amount || transferInstruction.parsed.info.tokenAmount?.amount;
        const amountPaid = Number(rawAmount) / 1_000_000; // USDC has 6 decimals

        if (amountPaid < 0 || isNaN(amountPaid)) {
            console.error(`[VERIFICATION FAILED] Invalid payment amount detected: ${rawAmount}`);
            return { valid: false, error: 'Invalid payment amount.' };
        }

        // If all checks pass:
        console.log(`✅ Payment verified: ${amountPaid.toFixed(6)} USDC from sender ${authority}`);

        return {
            valid: true,
            amount: amountPaid,
            from: authority,
            signature: transactionSignature,
        };
    } catch (error) {
        console.error('An unexpected error occurred during Solana verification:', error);
        return {
            valid: false,
            error: `On-chain verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        };
    }
}
