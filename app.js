const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ===============================
// CONFIGURACIÓN
// ===============================

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.set('trust proxy', 1);

app.use(session({
    secret: process.env.SESSION_SECRET || 'meu-controle-secreto-cambiar',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
}));

// ===============================
// BANCO DE DADOS
// ===============================

const db = new sqlite3.Database('./meu_controle.db');

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(this);
            }
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

// ===============================
// INICIALIZAR BANCO
// ===============================

async function iniciarBanco() {

    await run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            senha TEXT NOT NULL
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS movimentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo TEXT NOT NULL,
            descricao TEXT NOT NULL,
            valor REAL NOT NULL,
            usuario_id INTEGER,
            categoria TEXT,
            data DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Verificar colunas existentes
    const colunas = await all(`PRAGMA table_info(movimentos)`);

    const nomesColunas = colunas.map(coluna => coluna.name);

    if (!nomesColunas.includes('usuario_id')) {
        await run(`
            ALTER TABLE movimentos
            ADD COLUMN usuario_id INTEGER
        `);

        console.log('Coluna usuario_id adicionada.');
    }

    if (!nomesColunas.includes('categoria')) {
        await run(`
            ALTER TABLE movimentos
            ADD COLUMN categoria TEXT
        `);

        console.log('Coluna categoria adicionada.');
    }

    console.log('Banco de dados pronto.');
}

// ===============================
// MIDDLEWARE
// ===============================

function verificarLogin(req, res, next) {

    if (!req.session.usuario) {
        return res.redirect('/login');
    }

    next();
}

// ===============================
// LOGIN
// ===============================

app.get('/login', (req, res) => {

    if (req.session.usuario) {
        return res.redirect('/');
    }

    res.render('login');
});

app.post('/login', async (req, res) => {

    try {

        const { email, senha } = req.body;

        if (!email || !senha) {
            return res.send('Preencha email e senha.');
        }

        const usuario = await get(
            'SELECT * FROM usuarios WHERE email = ?',
            [email]
        );

        if (!usuario) {
            return res.send('Usuário não encontrado.');
        }

        const senhaCorreta = await bcrypt.compare(
            senha,
            usuario.senha
        );

        if (!senhaCorreta) {
            return res.send('Senha incorreta.');
        }

        req.session.usuario = {
            id: usuario.id,
            nome: usuario.nome,
            email: usuario.email
        };

        res.redirect('/');

    } catch (erro) {

        console.error(erro);
        res.status(500).send('Erro no servidor.');

    }

});

// ===============================
// REGISTRO
// ===============================

app.get('/registro', (req, res) => {

    if (req.session.usuario) {
        return res.redirect('/');
    }

    res.render('registro');
});

app.post('/registro', async (req, res) => {

    try {

        const { nome, email, senha } = req.body;

        if (!nome || !email || !senha) {
            return res.send('Preencha todos os campos.');
        }

        if (senha.length < 6) {
            return res.send('A senha precisa ter pelo menos 6 caracteres.');
        }

        const senhaCriptografada = await bcrypt.hash(senha, 10);

        await run(
            `
            INSERT INTO usuarios (nome, email, senha)
            VALUES (?, ?, ?)
            `,
            [nome, email, senhaCriptografada]
        );

        res.redirect('/login');

    } catch (erro) {

        console.error(erro);

        if (erro.message.includes('UNIQUE')) {
            return res.send('Este email já está cadastrado.');
        }

        res.status(500).send('Erro ao criar usuário.');

    }

});

// ===============================
// LOGOUT
// ===============================

app.get('/logout', (req, res) => {

    req.session.destroy(() => {
        res.redirect('/login');
    });

});

// ===============================
// DASHBOARD
// ===============================

app.get('/', verificarLogin, async (req, res) => {

    try {

        const usuarioId = req.session.usuario.id;

        const movimentos = await all(
            `
            SELECT *
            FROM movimentos
            WHERE usuario_id = ?
            ORDER BY id DESC
            `,
            [usuarioId]
        );

        let entradas = 0;
        let saidas = 0;

        movimentos.forEach(movimento => {

            if (movimento.tipo === 'entrada') {
                entradas += Number(movimento.valor);
            } else {
                saidas += Number(movimento.valor);
            }

        });

        const saldo = entradas - saidas;

        const lista = movimentos.map(movimento => `

            <div class="movimento">

                <div>

                    <strong>
                        ${movimento.tipo === 'entrada'
                            ? '💰 Entrada'
                            : '💸 Saída'}
                    </strong>

                    <p>${movimento.descricao}</p>

                    <p>
                        📂 ${movimento.categoria || 'Sem categoria'}
                    </p>

                </div>

                <div>

                    <strong>
                        ${movimento.tipo === 'entrada' ? '+' : '-'}
                        R$ ${Number(movimento.valor).toFixed(2)}
                    </strong>

                    <br><br>

                    <a href="/editar/${movimento.id}">
                        ✏️ Editar
                    </a>

                    <form
                        action="/eliminar/${movimento.id}"
                        method="POST"
                        style="display:inline;"
                    >

                        <button type="submit">
                            🗑️ Eliminar
                        </button>

                    </form>

                </div>

            </div>

        `).join('');

        res.send(`

<!DOCTYPE html>

<html lang="pt-BR">

<head>

    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <title>Meu Controle</title>

    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

    <link rel="stylesheet" href="/style.css">

</head>

<body>

<div class="container">

    <header>

        <h1>💰 Meu Controle</h1>

        <p>
            Controle suas finanças de forma simples.
        </p>

    </header>

    <nav class="menu">

        <a href="/">
            🏠 Dashboard
        </a>

        <a href="/estatisticas">
            📊 Relatórios
        </a>

        <a href="/perfil">
            ⚙️ Perfil
        </a>

        <span class="usuario">
            👋 ${req.session.usuario.nome}
        </span>

        <a href="/logout">
            🚪 Sair
        </a>

    </nav>

    <div class="cards">

        <div class="card">

            <span>Saldo atual</span>

            <strong>
                R$ ${saldo.toFixed(2)}
            </strong>

        </div>

        <div class="card">

            <span>Total de entradas</span>

            <strong class="entrada">
                R$ ${entradas.toFixed(2)}
            </strong>

        </div>

        <div class="card">

            <span>Total de saídas</span>

            <strong class="saida">
                R$ ${saidas.toFixed(2)}
            </strong>

        </div>

    </div>

    <div class="grafico-container">

        <canvas id="grafico"></canvas>

    </div>

    <div class="form-box">

        <h2>Adicionar movimento</h2>

        <form action="/adicionar" method="POST">

            <select name="tipo">

                <option value="entrada">
                    💰 Entrada
                </option>

                <option value="saida">
                    💸 Saída
                </option>

            </select>

            <select name="categoria">

                <option value="Salário">
                    💼 Salário
                </option>

                <option value="Alimentação">
                    🍔 Alimentação
                </option>

                <option value="Transporte">
                    🚗 Transporte
                </option>

                <option value="Moradia">
                    🏠 Moradia
                </option>

                <option value="Lazer">
                    🎮 Lazer
                </option>

                <option value="Saúde">
                    🏥 Saúde
                </option>

                <option value="Outros">
                    📦 Outros
                </option>

            </select>

            <input
                type="text"
                name="descricao"
                placeholder="Descrição"
                required
            >

            <input
                type="number"
                name="valor"
                step="0.01"
                min="0.01"
                placeholder="Valor"
                required
            >

            <button type="submit">
                Adicionar movimento
            </button>

        </form>

    </div>

    <div class="movimentos">

        <h2>Histórico</h2>

        ${
            lista ||
            '<p>Nenhum movimento cadastrado.</p>'
        }

    </div>

</div>

<script>

const ctx = document.getElementById('grafico');

new Chart(ctx, {

    type: 'doughnut',

    data: {

        labels: [
            'Entradas',
            'Saídas'
        ],

        datasets: [{

            data: [
                ${entradas},
                ${saidas}
            ]

        }]

    }

});

</script>

</body>

</html>

        `);

    } catch (erro) {

        console.error(erro);
        res.status(500).send('Erro ao carregar dashboard.');

    }

});

// ===============================
// ADICIONAR MOVIMENTO
// ===============================

app.post('/adicionar', verificarLogin, async (req, res) => {

    try {

        const {
            tipo,
            categoria,
            descricao,
            valor
        } = req.body;

        const usuarioId = req.session.usuario.id;

        const valorNumerico = Number(valor);

        if (
            !['entrada', 'saida'].includes(tipo) ||
            !descricao ||
            !valorNumerico ||
            valorNumerico <= 0
        ) {
            return res.send('Dados do movimento inválidos.');
        }

        await run(
            `
            INSERT INTO movimentos
            (tipo, categoria, descricao, valor, usuario_id)
            VALUES (?, ?, ?, ?, ?)
            `,
            [
                tipo,
                categoria,
                descricao,
                valorNumerico,
                usuarioId
            ]
        );

        res.redirect('/');

    } catch (erro) {

        console.error(erro);
        res.status(500).send('Erro ao adicionar movimento.');

    }

});

// ===============================
// EDITAR MOVIMENTO
// ===============================

app.get('/editar/:id', verificarLogin, async (req, res) => {

    try {

        const id = req.params.id;
        const usuarioId = req.session.usuario.id;

        const movimento = await get(
            `
            SELECT *
            FROM movimentos
            WHERE id = ?
            AND usuario_id = ?
            `,
            [id, usuarioId]
        );

        if (!movimento) {
            return res.status(404).send(
                'Movimento não encontrado.'
            );
        }

        res.send(`

<!DOCTYPE html>

<html lang="pt-BR">

<head>

    <meta charset="UTF-8">

    <title>Editar Movimento</title>

    <link rel="stylesheet" href="/style.css">

</head>

<body>

<div class="container">

    <div class="form-box">

        <h2>✏️ Editar movimento</h2>

        <form
            action="/editar/${movimento.id}"
            method="POST"
        >

            <select name="tipo">

                <option
                    value="entrada"
                    ${movimento.tipo === 'entrada'
                        ? 'selected'
                        : ''}
                >
                    💰 Entrada
                </option>

                <option
                    value="saida"
                    ${movimento.tipo === 'saida'
                        ? 'selected'
                        : ''}
                >
                    💸 Saída
                </option>

            </select>

            <select name="categoria">

                <option
                    value="Salário"
                    ${movimento.categoria === 'Salário'
                        ? 'selected'
                        : ''}
                >
                    💼 Salário
                </option>

                <option
                    value="Alimentação"
                    ${movimento.categoria === 'Alimentação'
                        ? 'selected'
                        : ''}
                >
                    🍔 Alimentação
                </option>

                <option
                    value="Transporte"
                    ${movimento.categoria === 'Transporte'
                        ? 'selected'
                        : ''}
                >
                    🚗 Transporte
                </option>

                <option
                    value="Moradia"
                    ${movimento.categoria === 'Moradia'
                        ? 'selected'
                        : ''}
                >
                    🏠 Moradia
                </option>

                <option
                    value="Lazer"
                    ${movimento.categoria === 'Lazer'
                        ? 'selected'
                        : ''}
                >
                    🎮 Lazer
                </option>

                <option
                    value="Saúde"
                    ${movimento.categoria === 'Saúde'
                        ? 'selected'
                        : ''}
                >
                    🏥 Saúde
                </option>

                <option
                    value="Outros"
                    ${movimento.categoria === 'Outros'
                        ? 'selected'
                        : ''}
                >
                    📦 Outros
                </option>

            </select>

            <input
                type="text"
                name="descricao"
                value="${movimento.descricao}"
                required
            >

            <input
                type="number"
                name="valor"
                step="0.01"
                min="0.01"
                value="${movimento.valor}"
                required
            >

            <button type="submit">
                Salvar alteração
            </button>

        </form>

        <br>

        <a href="/">
            ← Voltar
        </a>

    </div>

</div>

</body>

</html>

        `);

    } catch (erro) {

        console.error(erro);
        res.status(500).send('Erro ao carregar movimento.');

    }

});

// ===============================
// SALVAR EDIÇÃO
// ===============================

app.post('/editar/:id', verificarLogin, async (req, res) => {

    try {

        const id = req.params.id;
        const usuarioId = req.session.usuario.id;

        const {
            tipo,
            categoria,
            descricao,
            valor
        } = req.body;

        const valorNumerico = Number(valor);

        if (
            !['entrada', 'saida'].includes(tipo) ||
            !descricao ||
            !valorNumerico ||
            valorNumerico <= 0
        ) {
            return res.send('Dados inválidos.');
        }

        const resultado = await run(
            `
            UPDATE movimentos

            SET
                tipo = ?,
                categoria = ?,
                descricao = ?,
                valor = ?

            WHERE id = ?
            AND usuario_id = ?
            `,
            [
                tipo,
                categoria,
                descricao,
                valorNumerico,
                id,
                usuarioId
            ]
        );

        if (resultado.changes === 0) {
            return res.status(404).send(
                'Movimento não encontrado.'
            );
        }

        res.redirect('/');

    } catch (erro) {

        console.error(erro);
        res.status(500).send('Erro ao editar movimento.');

    }

});

// ===============================
// ELIMINAR MOVIMENTO
// ===============================

app.post('/eliminar/:id', verificarLogin, async (req, res) => {

    try {

        const id = req.params.id;
        const usuarioId = req.session.usuario.id;

        const resultado = await run(
            `
            DELETE FROM movimentos

            WHERE id = ?
            AND usuario_id = ?
            `,
            [id, usuarioId]
        );

        if (resultado.changes === 0) {
            return res.status(404).send(
                'Movimento não encontrado.'
            );
        }

        res.redirect('/');

    } catch (erro) {

        console.error(erro);
        res.status(500).send('Erro ao eliminar movimento.');

    }

});

// ===============================
// PERFIL
// ===============================

app.get('/perfil', verificarLogin, (req, res) => {

    const usuario = req.session.usuario;

    res.send(`

<!DOCTYPE html>

<html lang="pt-BR">

<head>

    <meta charset="UTF-8">

    <title>Perfil - Meu Controle</title>

    <link rel="stylesheet" href="/style.css">

</head>

<body>

<div class="container">

    <div class="form-box">

        <h2>⚙️ Meu Perfil</h2>

        <p>
            👤 Nome:
            <strong>${usuario.nome}</strong>
        </p>

        <p>
            📧 Email:
            <strong>${usuario.email}</strong>
        </p>

        <br>

        <a href="/">
            ← Voltar ao Dashboard
        </a>

    </div>

</div>

</body>

</html>

    `);

});

// ===============================
// RELATÓRIOS
// ===============================

app.get('/estatisticas', verificarLogin, async (req, res) => {

    try {

        const usuarioId = req.session.usuario.id;

        const dados = await all(
            `
            SELECT
                categoria,
                SUM(valor) AS total

            FROM movimentos

            WHERE usuario_id = ?
            AND tipo = 'saida'

            GROUP BY categoria

            ORDER BY total DESC
            `,
            [usuarioId]
        );

        const lista = dados.map(item => `

            <p>
                📂 ${item.categoria || 'Sem categoria'} -
                <strong>
                    R$ ${Number(item.total).toFixed(2)}
                </strong>
            </p>

        `).join('');

        res.send(`

<!DOCTYPE html>

<html lang="pt-BR">

<head>

    <meta charset="UTF-8">

    <title>Relatórios - Meu Controle</title>

    <link rel="stylesheet" href="/style.css">

</head>

<body>

<div class="container">

    <div class="form-box">

        <h2>📊 Gastos por categoria</h2>

        ${lista || '<p>Nenhum gasto cadastrado.</p>'}

        <br>

        <a href="/">
            ← Voltar ao Dashboard
        </a>

    </div>

</div>

</body>

</html>

        `);

    } catch (erro) {

        console.error(erro);
        res.status(500).send('Erro ao gerar relatório.');

    }

});

// ===============================
// INICIAR SERVIDOR
// ===============================

iniciarBanco()
    .then(() => {

        app.listen(PORT, '0.0.0.0', () => {

            console.log(
                `Servidor rodando na porta ${PORT}`
            );

        });

    })
    .catch(erro => {

        console.error(
            'Erro ao inicializar banco:',
            erro
        );

    });