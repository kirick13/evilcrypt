
import { randomBytes } from 'node:crypto';
import * as aes        from '../crypto/aes.js';
import { pbkdf2 }      from '../crypto/pbkdf2.js';

const VERSION_ID_BUFFER = Buffer.from([ 2 ]);

const AES_ALGORITHM = 'aes-256-cbc';

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_MESSAGE_KEY_LENGTH = 12;
const PBKDF2_AES_KEY_LENGTH = 64;
const PBKDF2_DIGEST = 'sha256';

async function getMessageKey(payload, key_right) {
	return pbkdf2(
		payload,
		key_right,
		PBKDF2_ITERATIONS,
		PBKDF2_MESSAGE_KEY_LENGTH,
		PBKDF2_DIGEST,
	);
}

async function getAesArguments(key_left, message_key) {
	const derived = await pbkdf2(
		key_left,
		message_key,
		PBKDF2_ITERATIONS,
		PBKDF2_AES_KEY_LENGTH,
		PBKDF2_DIGEST,
	);

	return {
		aes_iv: derived.subarray(0, 16),
		aes_key: derived.subarray(32),
	};
}

/**
 * Encrypts a message using EvilCrypt algorithm #2.
 * @async
 * @param {Buffer} message The message to encrypt.
 * @param {Buffer} key The 64 byte key to encrypt with.
 * @returns {Buffer} The encrypted message.
 */
export async function encrypt(message, key) {
	if (key.byteLength !== 64) {
		throw new Error('Key must be 64 bytes.');
	}

	// 4-7 bytes
	// first byte of padding contains
	// - 2 bits of additional padding length (values 0-3)
	// - 6 random bits
	const padding_bytes_meta = randomBytes(1);
	const padding_additional_bytes_count = padding_bytes_meta[0] >>> 6; // eslint-disable-line no-bitwise

	const payload = Buffer.concat([
		padding_bytes_meta,
		randomBytes(4 + padding_additional_bytes_count),
		message,
	]);

	const key_left = key.subarray(0, 32);
	const key_right = key.subarray(32);

	const message_key = await getMessageKey(payload, key_right);

	const { aes_iv, aes_key } = await getAesArguments(key_left, message_key);

	let payload_encrypted;
	try {
		payload_encrypted = aes.encrypt(
			AES_ALGORITHM,
			aes_iv,
			aes_key,
			payload,
		);
	}
	catch {
		throw new Error('Encrypt error.');
	}

	return Buffer.concat([
		VERSION_ID_BUFFER,
		message_key,
		payload_encrypted,
	]);
}

/**
 * Decrypts a message using EvilCrypt algorithm #2.
 * @async
 * @param {Buffer} message_encrypted The encrypted message to decrypt.
 * @param {Buffer} key The 64 byte key to decrypt with.
 * @returns {Buffer} The decrypted message.
 */
export async function decrypt(message_encrypted, key) {
	if (key.byteLength !== 64) {
		throw new Error('Key must be 64 bytes.');
	}

	const message_key = message_encrypted.subarray(
		1,
		PBKDF2_MESSAGE_KEY_LENGTH + 1,
	);
	const payload_encrypted = message_encrypted.subarray(PBKDF2_MESSAGE_KEY_LENGTH + 1);

	const key_left = key.subarray(0, 32);
	const key_right = key.subarray(32);

	const { aes_iv, aes_key } = await getAesArguments(key_left, message_key);

	let payload;
	try {
		payload = aes.decrypt(
			AES_ALGORITHM,
			aes_iv,
			aes_key,
			payload_encrypted,
		);
	}
	catch {
		throw new Error('Decrypt error.');
	}

	const message_key_check = await getMessageKey(payload, key_right);

	if (message_key_check.equals(message_key) !== true) {
		throw new Error('Decrypt error.');
	}

	return payload.subarray(
		4 + (payload[0] >>> 6) + 1, // eslint-disable-line no-bitwise
	);
}
