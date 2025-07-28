import {promisePool} from '../../lib/db';
import {
  UserWithLevel,
  User,
  UserWithNoPassword,
  ProfilePicture,
  UserCheck,
} from 'hybrid-types/DBTypes';
import {UserDeleteResponse, MessageResponse} from 'hybrid-types/MessageTypes';
import CustomError from '../../classes/CustomError';
import {customLog, fetchData} from '../../lib/functions';

const profilePicDir = process.env.PROFILE_UPLOAD_URL;

const getUserById = async (user_id: number): Promise<Partial<User> | null> => {
  const query = `
    SELECT
      u.user_id,
      u.username,
      u.email,
      u.created_at,
      ul.level_name,
      pp.filename
    FROM "Users" u
    JOIN "UserLevels" ul ON u.user_level_id = ul.user_level_id
    LEFT JOIN "ProfilePicture" pp ON u.user_id = pp.user_id
    WHERE u.user_id = $1
  `;

  try {
    const result = await promisePool.query<
      Partial<User> & {level_name: string; filename: string | null}
    >(query, [user_id]);

    const user = result.rows[0];
    if (!user) return null;

    if (user.filename) {
      user.filename = `${profilePicDir}${user.filename}`;
    }

    return user;
  } catch (error) {
    console.error('Error retrieving user by ID:', error);
    throw new Error('Failed to retrieve user');
  }
};

const getUserByEmail = async (email: string): Promise<UserWithLevel | null> => {
  const query = `
    SELECT
      u.user_id,
      u.username,
      u.email,
      u.created_at,
      ul.level_name,
      u.user_level_id,
      u.password
    FROM "Users" u
    JOIN "UserLevels" ul ON u.user_level_id = ul.user_level_id
    WHERE u.email = $1
  `;

  try {
    const result = await promisePool.query<UserWithLevel>(query, [email]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error retrieving user by email:', error);
    throw new Error('Failed to retrieve user by email');
  }
}


const createUser = async (
  user: Omit<User, 'user_id' | 'created_at'>,
): Promise<UserWithLevel> => {
  const {username, email, password, user_level_id} = user;

  const insertQuery = `
    INSERT INTO "Users" (username, email, password, user_level_id)
    VALUES ($1, $2, $3, $4)
    RETURNING user_id, username, email, created_at, user_level_id
  `;

  try {
    const result = await promisePool.query<User>(insertQuery, [
      username,
      email,
      password,
      user_level_id,
    ]);

    const newUser = result.rows[0];

    // Get level_name
    const levelResult = await promisePool.query<UserWithLevel>(
      `SELECT level_name FROM "UserLevels" WHERE user_level_id = $1`,
      [newUser.user_level_id]
    );

    return {...newUser, level_name: levelResult.rows[0]?.level_name};
  } catch (error) {
    console.error('Error creating user:', error);
    throw new CustomError('Failed to create user', 500);
  }
};


const getUserByUsername = async (
  username: string,
): Promise<UserWithNoPassword | null> => {
  const query = `
    SELECT
      u.user_id,
      u.username,
      u.email,
      u.created_at,
      ul.level_name,
      u.user_level_id,
      pp.filename
    FROM "Users" u
    JOIN "UserLevels" ul ON u.user_level_id = ul.user_level_id
    LEFT JOIN "ProfilePicture" pp ON u.user_id = pp.user_id
    WHERE u.username = $1
  `;
  try {
    const result = await promisePool.query<UserWithNoPassword>(query, [username]);
    const user = result.rows[0];
    if (!user) return null;

    if (user.filename) {
      user.filename = `${profilePicDir}${user.filename}`;
    }

    return user;
  } catch (error) {
    console.error('Error retrieving user by username:', error);
    throw new Error('Failed to retrieve user by username');
  }
};

const deleteUser = async (
  user_id: number
): Promise<UserDeleteResponse> => {
  const client = await promisePool.connect();

  try {
    await client.query('BEGIN');

    // Delete profile picture if it exists
    const existingProfilePic = await checkProfilePicExists(user_id);

    if (
      existingProfilePic?.filename &&
      existingProfilePic.user_id === user_id
    ) {
      try {
        const absolutePath = existingProfilePic.filename.split('/').pop();
        console.log('absolutePath', absolutePath);
        const options = {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ user_id }),
        };

        const deleteResult = await fetchData<MessageResponse>(
          `${process.env.UPLOAD_SERVER}/upload/profile/${absolutePath}`,
          options
        );
        console.log('deleteResult', deleteResult);
      } catch (error) {
        console.error('Error deleting profile pic:', (error as Error).message);
      }
    }

    await client.query('DELETE FROM ProfilePicture WHERE user_id = $1', [user_id]);

    const result = await client.query(
      'DELETE FROM Users WHERE user_id = $1 RETURNING user_id',
      [user_id]
    );

    await client.query('COMMIT');

    if (result.rowCount === 0) {
      throw new CustomError('User not deleted', 500);
    }

    return { message: 'User deleted successfully', user: { user_id } };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error((error as Error).message);
    throw new CustomError('Error deleting user', 500);
  } finally {
    client.release();
  }
};

// Check if user has a profile picture already
const checkProfilePicExists = async (
  user_id: number,
): Promise<ProfilePicture | null> => {
  const query = `
    SELECT
      pp.profile_picture_id,
      pp.user_id,
      pp.filename,
      pp.filesize,
      pp.media_type,
      CONCAT(v.base_url, pp.filename) AS filename
    FROM ProfilePicture pp
    CROSS JOIN (SELECT $1 AS base_url) AS v
    WHERE pp.user_id = $2
    `;
  const result = await promisePool.query<ProfilePicture>(query, [profilePicDir, user_id]);
  const rows = result.rows;

  if (rows.length === 0) {
    customLog('checkProfilePicExists: Profile picture not found');
    return null;
  }

  return rows[0] || null;
};

// Post profile picture
const postProfilePic = async (
  media: Omit<ProfilePicture, 'profile_picture_id' | 'created_at'>,
): Promise<ProfilePicture> => {
  const { user_id, filename, filesize, media_type } = media; // media_type always 'image'

  const sql = `
    INSERT INTO "ProfilePicture" (user_id, filename, filesize, media_type)
    VALUES ($1, $2, $3, $4)
    RETURNING profile_picture_id
  `;

  const result = await promisePool.query(sql, [
    user_id,
    filename,
    filesize,
    media_type,
  ]);

  if (result.rows.length === 0) {
    throw new CustomError('Profile picture not created', 500);
  }

  const insertedId = result.rows[0].profile_picture_id;

  return await getProfilePicById(insertedId);
};


// Get profile picture by id
const getProfilePicById = async (
  profile_picture_id: number,
): Promise<ProfilePicture> => {
  const result = await promisePool.query<ProfilePicture>(
    `SELECT * FROM "ProfilePicture" WHERE profile_picture_id = $1`,
    [profile_picture_id],
  );

  if (result.rows.length === 0) {
    customLog('getProfilePicById: Profile picture not found');
    throw new CustomError('Profile picture not found', 404);
  }

  return result.rows[0];
};

const getProfilePicByUserId = async (
  user_id: number,
): Promise<ProfilePicture | null> => {
  const result = await promisePool.query<ProfilePicture>(
    `SELECT
      pp.profile_picture_id,
      pp.user_id,
      pp.filename AS original_filename,
      pp.filesize,
      pp.media_type,
      CONCAT(v.base_url, pp.filename) AS filename
    FROM ProfilePicture pp
    CROSS JOIN (SELECT ? AS base_url) AS v
    WHERE pp.user_id = ?`,
    [profilePicDir, user_id],
  );
  if (!result.rows || result.rows.length === 0) {
    customLog('getProfilePicByUserId: Profile picture not found');
    throw new CustomError('Profile picture not found', 404);
  }
  return result.rows[0] || null;
};

const putProfilePic = async (
  media: ProfilePicture,
  user_id: number,
): Promise<ProfilePicture> => {
  const { filename, filesize, media_type } = media;

  const existingProfilePic = await checkProfilePicExists(user_id);
  console.log('existingProfilePic', existingProfilePic);

  let query: string;
  let params: (string | number)[];

  if (existingProfilePic) {
    query = `
      UPDATE "ProfilePicture"
      SET filename = $1, filesize = $2, media_type = $3
      WHERE user_id = $4
      RETURNING *;
    `;
    params = [filename, filesize, media_type, user_id];
  } else {
    query = `
      INSERT INTO "ProfilePicture" (user_id, filename, filesize, media_type)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    params = [user_id, filename, filesize, media_type];
  }

  const result = await promisePool.query(query, params);
  console.log('result', result.rows);

  if (result.rowCount === 0) {
    throw new CustomError('Profile picture not updated or inserted', 500);
  }

  // delete existing profile picture file if replacing
  if (existingProfilePic?.filename && existingProfilePic.user_id === user_id) {
    try {
      const absolutePath = existingProfilePic.filename.split('/').pop();
      console.log('absolutePath', absolutePath);
      const options = {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_id }),
      };

      const deleteResult = await fetchData<MessageResponse>(
        `${process.env.UPLOAD_SERVER}/upload/profile/${absolutePath}`,
        options,
      );
      console.log('deleteResult', deleteResult);
    } catch (error) {
      console.error((error as Error).message);
    }
  }

  const profilePic = await getProfilePicByUserId(user_id);
  if (!profilePic) {
    throw new CustomError('Profile picture not found', 404);
  }
  return profilePic;
};


const updateUserDetails = async (
  user_id: number,
  userDetails: Partial<Pick<User, 'username' | 'email'>>
): Promise<User> => {
  const connection = await promisePool.connect();

  try {
    await connection.query('BEGIN');

    const updateFields = [];
    const updateValues = [];

    // Dynamically assign placeholders $1, $2, ...
    let paramIndex = 1;

    if (userDetails.username !== undefined) {
      updateFields.push(`username = $${paramIndex++}`);
      updateValues.push(userDetails.username);
    }
    if (userDetails.email !== undefined) {
      updateFields.push(`email = $${paramIndex++}`);
      updateValues.push(userDetails.email);
    }

    if (updateFields.length > 0) {
      // Add user_id as last parameter
      updateValues.push(user_id);
      const userIdPlaceholder = `$${paramIndex}`;

      const sql = `UPDATE "Users" SET ${updateFields.join(', ')} WHERE user_id = ${userIdPlaceholder}`;

      await connection.query(sql, updateValues);
    }

    await connection.query('COMMIT');

    const updatedUser = await getUserById(user_id);
    if (!updatedUser) {
      throw new CustomError('User not found', 404);
    }
    return updatedUser as User;
  } catch (error) {
    await connection.query('ROLLBACK');
    console.error(error);
    throw new CustomError('Failed to update user details', 500);
  } finally {
    connection.release();
  }
};


const getUserExistsByEmail = async (
  email: string,
): Promise<Partial<UserCheck> | null> => {
  const rows = await promisePool.query<Partial<UserCheck>>(
    'SELECT user_id, email FROM Users WHERE email = ?',
    [email],
  );

  return rows.rows[0] || null;
};

const getUsernameById = async (user_id: number): Promise<Partial<User>> => {
  const rows = await promisePool.query<Partial<User>>(
    'SELECT user_id, username FROM Users WHERE user_id = ?',
    [user_id],
  );

  if (rows.rows.length === 0) {
    throw new CustomError('User not found', 404);
  }

  return rows.rows[0];
};

const changeUserLevel = async (
  user_id: number,
  user_level_id: number,
): Promise<MessageResponse> => {
  const query = `
    UPDATE "Users"
    SET user_level_id = $1
    WHERE user_id = $2
  `;

  try {
    const result = await promisePool.query(query, [user_level_id, user_id]);

    if (result.rowCount === 0) {
      throw new CustomError('User not found or level not changed', 404);
    }

    return { message: 'User level updated successfully' };
  } catch (error) {
    console.error('Error changing user level:', error);
    throw new CustomError('Failed to change user level', 500);
  }
};

export {
  getUserById,
  getUserByEmail,
  createUser,
  getUserByUsername,
  deleteUser,
  checkProfilePicExists,
  postProfilePic,
  getProfilePicById,
  putProfilePic,
  updateUserDetails,
  getUserExistsByEmail,
  getUsernameById,
  changeUserLevel,
};
