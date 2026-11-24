module.exports = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://picking:picking@localhost:5432/picking',
  lockTtlSecs: Number(process.env.PICK_LOCK_TTL_SECONDS || 900),
};
