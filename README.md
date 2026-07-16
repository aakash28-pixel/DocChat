# 📄 DocChat

**DocChat** is a production-ready Retrieval-Augmented Generation (RAG) Document Q&A application engineered to seamlessly interact with your documents. Moving beyond basic search, DocChat acts as an intelligent assistant that provides accurate, context-aware answers directly from your uploaded source material, with citations you can trust.

🌐 **Live Website & App:** https://doc-chat-theta-three.vercel.app/#

🔗 ✨ **Standout Features**
---
* 🤖 **Advanced RAG Pipeline:** Efficient document parsing and intelligent question-answering capabilities for immediate insights, with ground-truth verification.
* 🔒 **Enhanced Security:** Integrated with Cloudflare Turnstile CAPTCHA for secure, environment-gated authentication, keeping unauthorized access out.
* 🐳 **Production-Ready Architecture:** Clean separation of concerns with dedicated `rag-frontend` and `rag-backend` modules, fully containerized via Docker for scalable deployment.
* ⚙️ **Automated CI/CD:** Integrated GitHub Actions workflows for continuous integration and automated testing (Pytest) ensuring zero compromise on code quality.
* ⚡ **One-Command Setup:** Custom scripts included to instantly spin up the backend and establish secure tunnels for rapid deployment and development.

🛠️ **Technical Stack & Workflow**
---
* **Platform:** Web Application (Cross-platform accessibility architecture).
* **Methodology:** Containerized microservices architecture for scalable deployment and rapid prototyping.
* **Deployment Architecture:** End-to-end product deployment utilizing Docker Compose and Caddy as a reverse proxy for secure production environments.

🚀 **How It Works**
---
Users simply upload their documents, and DocChat processes the data in the background using a state-of-the-art RAG pipeline. Once the context is set, users can query the application, and the system intelligently retrieves the most relevant information, neutralizing the need for manual document searching.

*Built with passion and advanced AI workflows by Aakash Ali.*

📸 **Application Screenshots**
---

### Landing Page Flow
A seamless visual experience from introduction to call-to-action.

<p align="center">
  <img width="30%" alt="DocChat Landing Page Hero" src="https://github.com/user-attachments/assets/004fb73d-8547-4469-8ac7-316719caf8d7" />
  <img width="30%" alt="DocChat Feature Cards" src="https://github.com/user-attachments/assets/02751919-3648-472c-921d-b07387388ed2" />
  <img width="30%" alt="DocChat How it Works & CTA" src="https://github.com/user-attachments/assets/6a203103-5fd9-4ca7-8230-e7d1f5bf67d8" />
</p>

### Core Application Experience
A clean and intuitive user interface designed for production.

| Login with Turnstile | Application Overview | Document Summary |
| :-: | :-: | :-: |
| <img alt="DocChat Login Page" src="https://github.com/user-attachments/assets/c3ca3f56-537c-47f4-b3de-0e8432d7e99b" width="100%"/> | <img alt="DocChat Application View" src="https://github.com/user-attachments/assets/2d72a6fd-6a0a-4d05-b2ba-7d3e4246c5d0" width="100%"/> | <img alt="DocChat Summary View" src="https://github.com/user-attachments/assets/42936745-ac75-4688-9436-ff8e1cc1655a" width="100%"/> |

### Document Conversation with Citations
Interact with documents in your native language (including Roman Urdu) with verifiable page-level citations.

<p align="center">
  <img width="70%" alt="DocChat Full Conversation View" src="https://github.com/user-attachments/assets/ecc2b46d-5fa4-4299-93e6-53d11ab611b8" />
</p>
