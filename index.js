require('dotenv').config();
const { Client, GatewayIntentBits, ButtonBuilder, ButtonStyle, ActionRowBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const nodemailer = require('nodemailer');
const svgCaptcha = require('svg-captcha');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

const VERIFY_ROLE_NAME = "Verified";
let emailCodes = {}; // { email: code }
let captchaTexts = {}; // { email: captchaText }

// Nodemailer Setup
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// --- Discord Slash Command Setup ---
client.once('ready', async () => {
    console.log(`Bot ist online als ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder().setName('setupverify').setDescription('Poste den Verify Button')
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID), { body: commands });
});

// --- Verify Button Command ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'setupverify') {
        const button = new ButtonBuilder()
            .setLabel('✅ Verify')
            .setStyle(ButtonStyle.Link)
            .setURL(`http://localhost:${PORT}/verify.html`);
        
        const row = new ActionRowBuilder().addComponents(button);
        await interaction.reply({ content: 'Klicke hier um dich zu verifizieren:', components: [row] });
    }
});

// --- Express Routes ---

// Schritt 1: Email senden
app.post('/sendcode', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    emailCodes[email] = code;

    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: "Dein Verify-Code",
            text: `Dein Verify-Code: ${code}`
        });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.json({ success: false, error: err.message });
    }
});

// Schritt 2: Code prüfen
app.post('/verifycode', (req, res) => {
    const { email, code } = req.body;
    if (emailCodes[email] && emailCodes[email] === code) {
        // Code korrekt → Generiere Captcha
        const captcha = svgCaptcha.create({ size: 5, noise: 2 });
        captchaTexts[email] = captcha.text;
        res.json({ success: true, captcha: captcha.data });
    } else {
        res.json({ success: false });
    }
});

// Schritt 3: Captcha prüfen + Rolle vergeben
app.post('/verifycaptcha', async (req, res) => {
    const { email, input, discordId } = req.body;
    if (captchaTexts[email] && captchaTexts[email].toLowerCase() === input.toLowerCase()) {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        let member = await guild.members.fetch(discordId);

        // Rolle prüfen/erstellen
        let role = guild.roles.cache.find(r => r.name === VERIFY_ROLE_NAME);
        if (!role) {
            role = await guild.roles.create({
                name: VERIFY_ROLE_NAME,
                color: 'Green',
                mentionable: true
            });
        }

        await member.roles.add(role);
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.listen(PORT, () => console.log(`Webserver läuft auf http://localhost:${PORT}`));

client.login(process.env.DISCORD_TOKEN);
