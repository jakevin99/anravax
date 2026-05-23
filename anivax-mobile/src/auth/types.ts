export type SessionUser = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  role: "PATIENT";
};

export type SessionPayload = {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string;
  refreshExpiresAt: string;
  user: SessionUser;
};
