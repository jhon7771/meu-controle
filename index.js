const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3000;

// Banco de dados
const db = new sqlite3.Database('./meu_controle.db');

// Criar tabela
db.run(`
    CREATE TABLE IF NOT EXISTS movimentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL,
        descricao TEXT NOT NULL,
        valor REAL NOT NULL,
        data DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// Configurações
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Página principal
app.get('/', (req, res) => {

    db.all(
        'SELECT * FROM movimentos ORDER BY id DESC',
        [],
        (err, movimentos) => {

            if (err) {
                return res.send('Erro ao buscar movimentos');
            }

            let entradas = 0;
            let saidas = 0;

            movimentos.forEach(movimento => {

                if (movimento.tipo === 'entrada') {
                    entradas += movimento.valor;
                } else {
                    saidas += movimento.valor;
                }

            });

            const saldo = entradas - saidas;

            let lista = movimentos.map(movimento => `

    <div class="movimento">

        <div>
            <strong>
                ${movimento.tipo === 'entrada' ? '💰 Entrada' : '💸 Saída'}
            </strong>

            <p>${movimento.descricao}</p>
        </div>

        <div>
            <strong class="${movimento.tipo}">
                ${movimento.tipo === 'entrada' ? '+' : '-'}
                R$ ${movimento.valor.toFixed(2)}
            </strong>

            <form action="/eliminar/${movimento.id}" method="POST">
                <button type="submit" class="btn-eliminar">
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

                    <meta name="viewport" content="width=device-width, initial-scale=1.0">

                    <title>Meu Controle</title>

                    <link rel="stylesheet" href="/style.css">

                </head>

                <body>

                    <div class="container">

                        <header>

                            <h1>💰 Meu Controle</h1>

                            <p>Controle suas finanças de forma simples.</p>

                        </header>


                        <div class="cards">

                            <div class="card saldo">

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

                            ${lista || '<p>Nenhum movimento cadastrado.</p>'}

                        </div>

                    </div>

                </body>

                </html>

            `);

        }
    );

});


// Adicionar movimento
app.post('/adicionar', (req, res) => {

    const { tipo, descricao, valor } = req.body;

    db.run(
        `INSERT INTO movimentos (tipo, descricao, valor)
         VALUES (?, ?, ?)`,
        [tipo, descricao, parseFloat(valor)],
        (err) => {

            if (err) {
                return res.send('Erro ao adicionar movimento');
            }

            res.redirect('/');

        }
    );

});

// Eliminar movimiento
app.post('/eliminar/:id', (req, res) => {

    const id = req.params.id;

    db.run(
        'DELETE FROM movimentos WHERE id = ?',
        [id],
        (err) => {

            if (err) {
                return res.send('Erro ao eliminar movimento');
            }

            res.redirect('/');
        }
    );

});
// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});