# 🤖 Vitrine Autônoma de Ofertas do Mercado Livre & Sistema de Mensagens

Site de achadinhos do Mercado Livre **100% autônomo** (piloto automático) integrado com **Sistema de Mensagens por Login Simples (Nome + Senha)** e Notificações Web.

---

## 🌐 Acesso Local:
* **Vitrine de Ofertas:** [http://localhost:3000](http://localhost:3000)
* **Painel do Dono:** [http://localhost:3000/admin.html](http://localhost:3000/admin.html)

---

## ⚡ 1. Robô de Ofertas 100% Autônomo (Zero Trabalho Manual)
* **Como funciona:** O robô (`auto-miner.js`) roda em segundo plano a cada 30 minutos.
* Ele rastreia e minera automaticamente as **ofertas mais quentes e com maiores descontos** do Mercado Livre (até 65% OFF).
* Ele injeta a sua tag de afiliado (`joaogustavo_13`) em cada link gerado automaticamente.
* Você não precisa cadastrar nenhum link e não precisa colocar nada em lista nenhuma: o site roda sozinho.
* No painel admin (`/admin.html`), há o botão **"⚡ Forçar Varredura do Robô Agora"** caso queira rodar uma nova rodada instantaneamente.

---

## 💬 2. Sistema de Mensagens com Login Simples (Nome + Senha)
* **Como o cliente usa:**
  1. No site, o cliente clica em **"Entrar / Cadastrar"** ou em **"Tirar Dúvida"** em qualquer oferta.
  2. Ele digita apenas **Nome de Usuário** e **Senha** (não pede telefone, e-mail ou WhatsApp).
  3. Se ele ainda não tiver conta, ela é criada na hora automaticamente.
  4. Ele envia a dúvida sobre o produto.
* **Notificações:**
  * **Notificação Web do Navegador:** Se o cliente estiver com o site aberto, o navegador dispara uma notificação web nativa quando você responder.
  * **Histórico Permanente ao Logar de Novo:** Se o cliente fechar a página ou for embora, basta ele entrar no site novamente com o **Nome e a Senha** dele e clicar em **"Minhas Mensagens"** para ver a resposta completa!
* **Como você responde:**
  * No painel [http://localhost:3000/admin.html](http://localhost:3000/admin.html), você vê a pergunta do cliente e o produto que ele quer.
  * Digita a resposta e clica em **Enviar Resposta**.
