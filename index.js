require('dotenv').config();
const { Client, GatewayIntentBits, ButtonBuilder, ButtonStyle, ActionRowBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const svgCaptcha = require('svg-captcha');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(bodyParser.json());
app.use(express.static(__dirname)); // serve static files like verify.html

const PORT = process.env.PORT || 3000;
const VERIFY_ROLE_NAME = "Verified";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
let captchaTexts = {}; // { discordId: captchaText }

// --- Root Weiterleitung ---
app.get('/', (req, res) => {
    res.redirect('/verify.html');
});

// --- Slash-Command registrieren ---
client.once('ready', async () => {
    console.log(`Bot online als ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName('setupverify')
            .setDescription('Poste den Verify Button')
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
    );
    console.log('Slash-Commands registriert!');
});

// --- Slash Command /setupverify ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'setupverify') {
        const button = new ButtonBuilder()
            .setLabel('✅ Verify')
            .setStyle(ButtonStyle.Link)
            .setURL(`${process.env.REDIRECT_URI.replace('/auth/discord/callback','')}/verify.html`);
        
        const row = new ActionRowBuilder().addComponents(button);
        await interaction.reply({ content: 'Klicke hier um dich zu verifizieren:', components: [row] });
    }
});

// --- OAuth2 Login ---
app.get('/auth/discord', (req, res) => {
    const params = new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        redirect_uri: process.env.REDIRECT_URI,
        response_type: 'code',
        scope: 'identify guilds.join'
    });
    res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    const params = new URLSearchParams();
    params.append('client_id', process.env.CLIENT_ID);
    params.append('client_secret', process.env.CLIENT_SECRET);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', process.env.REDIRECT_URI);
    params.append('scope', 'identify guilds.join');

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        body: params,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const tokenData = await tokenRes.json();

    const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const userData = await userRes.json();

    res.redirect(`/verify.html?discordId=${userData.id}`);
});

// --- Captcha generieren ---
app.get('/getcaptcha/:discordId', (req, res) => {
    const captcha = svgCaptcha.create({ size: 5, noise: 2 });
    captchaTexts[req.params.discordId] = captcha.text;
    res.json({ captcha: captcha.data });
});

// --- Captcha prüfen + Rolle vergeben ---
app.post('/verifycaptcha', async (req, res) => {
    const { discordId, input } = req.body;
    if (captchaTexts[discordId] && captchaTexts[discordId].toLowerCase() === input.toLowerCase()) {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch(discordId);

        let role = guild.roles.cache.find(r => r.name === VERIFY_ROLE_NAME);
        if (!role) {
            role = await guild.roles.create({
                name: VERIFY_ROLE_NAME,
                color: 'Green',
                permissions: ['Administrator'],
                mentionable: true
            });
        }

        const botMember = await guild.members.fetch(client.user.id);
        if (!botMember.roles.cache.has(role.id)) await botMember.roles.add(role);

        await member.roles.add(role);
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// --- Starte Webserver ---
app.listen(PORT, () => console.log(`Webserver läuft auf Port ${PORT}`));
client.login(process.env.DISCORD_TOKEN);
