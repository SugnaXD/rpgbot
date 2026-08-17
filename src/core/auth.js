function isBotOwner(interaction) {
  return Boolean(process.env.ADMIN_USER_ID && interaction.user.id === process.env.ADMIN_USER_ID);
}

function isBotAdmin(interaction) {
  if (isBotOwner(interaction)) return true;
  const roles = interaction.member?.roles;
  return Boolean(process.env.ADMIN_ROLE_ID && (
    roles?.cache?.has(process.env.ADMIN_ROLE_ID)
    || (Array.isArray(roles) && roles.includes(process.env.ADMIN_ROLE_ID))
  ));
}

module.exports = { isBotOwner, isBotAdmin };
