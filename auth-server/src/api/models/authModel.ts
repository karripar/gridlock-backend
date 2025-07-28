import bcrypt from 'bcryptjs';
import {v4 as uuidv4} from 'uuid';
import { promisePool } from '../../lib/db';
import { MessageResponse } from 'hybrid-types/MessageTypes';
import { ResetToken, User } from 'hybrid-types/DBTypes';

const createResetToken = async (
  user_id: number,
): Promise<string> => {
  try {
    const token = uuidv4();

    const expiration = new Date(Date.now() + 3600 * 1000); // 1 hour from now

    await promisePool.query(`
      INSERT INTO "ResetTokens"
      (user_id, token, expires_at)
      VALUES ($1, $2, $3)`, [user_id, token, expiration])

    return token;
  } catch (error) {
    console.error('Error creating reset token:', error);
    throw new Error('Error creating reset token');
  }
}

const verifyResetToken = async (
  token: string,
): Promise<ResetToken | null> => {
  try {
    const result = await promisePool.query<ResetToken>(
      'SELECT * FROM "ResetTokens" WHERE token = $1 AND expires_at > NOW() LIMIT 1',
      [token],
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error verifying reset token:', error);
    throw new Error('Error verifying reset token');
  }
}

const updatePassword = async (
  user_id: number,
  password: string,
): Promise<MessageResponse> => {
  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    await promisePool.query(
      'UPDATE "Users" SET password = $1 WHERE user_id = $2', [hashedPassword, user_id]);
    await promisePool.query(
      'DELETE FROM "ResetTokens" WHERE user_id = $1', [user_id]);
    return {
      message: 'Password updated successfully',
    };
  } catch (error) {
    console.error('Error updating password:', error);
    throw new Error('Error updating password');
  }
}

const putPassword = async (
  user_id: number,
  password: string,
): Promise<MessageResponse> => {
  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    await promisePool.query(
      'UPDATE "Users" SET password = $1 WHERE user_id = $2', [hashedPassword, user_id]);
    return {
      message: 'Password updated successfully',
    };
  } catch (error) {
    console.error('Error updating password:', error);
    throw new Error('Error updating password');
  }
}

const selectPasswordHash = async (user_id: number): Promise<string> => {
  try {
    const query = 'SELECT password FROM "Users" WHERE user_id = $1';
    const result = await promisePool.query<Pick<User, 'password'>>(query, [user_id]);

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    return result.rows[0].password;
  } catch (error) {
    console.error('Error selecting password hash:', error);
    throw new Error('Error selecting password hash');
  }
};


export {
  createResetToken,
  verifyResetToken,
  updatePassword,
  selectPasswordHash,
  putPassword,
}
