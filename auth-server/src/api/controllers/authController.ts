import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { NextFunction, Request, Response } from 'express';
import CustomError from '../../classes/CustomError';
import { LoginResponse, MessageResponse } from 'hybrid-types/MessageTypes';
import {getUserByEmail} from '../models/userModel';
import { UserWithLevel, TokenContent } from 'hybrid-types/DBTypes';
import { selectPasswordHash, putPassword} from '../models/authModel';

const Login = async (
  req: Request<object, object, { email: string, password: string }>,
  res: Response<LoginResponse>,
  next: NextFunction,
) => {
  try {
    const {email, password} = req.body;
    const user = await getUserByEmail(email);

    if (!user || !user.password) {
      next(new CustomError('Invalid credentials', 400));
      return;
    }

    const isMatched = await bcrypt.compare(password, user.password);
    if (!isMatched) {
      next(new CustomError('Invalid email or password', 400));
      return;
    }

    if (!process.env.JWT_SECRET) {
      next(new CustomError('Internal server error, JWT_SECRET not set', 500));
      return;
    }

    const Out: Omit<UserWithLevel, 'password'> = {
      user_id: user.user_id,
      username: user.username,
      email: user.email,
      created_at: user.created_at,
      level_name: user.level_name,
      user_level_id: user.user_level_id,
    };

    const tokenContent: TokenContent = {
      user_id: user.user_id,
      level_name: user.level_name
    }

    const token = jwt.sign(tokenContent, process.env.JWT_SECRET, {expiresIn: '3h'});

    res.json({
      message: 'Login successful',
      token,
      user: Out,
    });
  } catch (error) {
    next(new CustomError((error as Error).message, 500));
  }
}


const changePassword = async (
  req: Request<{user_id: string}, {current_password: string, new_password: string}>,
  res: Response<MessageResponse>,
  next: NextFunction,
) => {
  try {
    const {current_password, new_password} = req.body;
    const user_id = Number(res.locals.user.user_id);

    const oldPasswordHash = await selectPasswordHash(user_id);

    const pwMatch = await bcrypt.compare(current_password, oldPasswordHash);
    if (!pwMatch) {
      next(new CustomError('Invalid password', 401));
      return;
    }

    const success = await putPassword(user_id, new_password);
    if (!success) {
      next(new CustomError('Error updating password', 500));
      return;
    }
    res.json({
      message: 'Password updated successfully',
    });
  } catch (error) {
    next(new CustomError((error as Error).message, 500));
  }
}

export {
  Login,
  changePassword,
}
