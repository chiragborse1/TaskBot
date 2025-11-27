require('dotenv').config();
console.log("BOT_TOKEN:", process.env.BOT_TOKEN ? "✅ Loaded" : "❌ Missing");
console.log("CLIENT_ID:", process.env.CLIENT_ID);
console.log("GUILD_ID:", process.env.GUILD_ID);
