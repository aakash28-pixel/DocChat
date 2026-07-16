# 📄 DocChat

**DocChat** is a production-ready Retrieval-Augmented Generation (RAG) Document Q&A application engineered to seamlessly interact with your documents. Moving beyond basic search, DocChat acts as an intelligent assistant that provides accurate, context-aware answers directly from your uploaded source material, with citations you can trust.

🌐 **Live Website & App:** https://doc-chat-git-main-akashbaloch28-4165s-projects.vercel.app/

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
  <img src="Screenshot 2026-07-16 at 2.24.42 PM.png" alt="DocChat Landing Page Hero" width="30%" />
  <img src="Screenshot 2026-07-16 at 2.25.02 PM.jpg" alt="DocChat Feature Cards" width="30%" /> 
  <img src="Screenshot 2026-07-16 at 2.25.21 png" alt="DocChat How it Works & CTA" width="30%" />
</p>

### Core Application Experience
A clean and intuitive user interface designed for production.

| | | |
| --- | --- | --- |
| **Login with Turnstile**<br><img src="Screenshot 2026-07-16 at 2.25.44 PM.png" alt="DocChat Login Page" width="100%" /> | **Application Overview**<br><img src="Screenshot 2026-07-16 at 2.26.46 PM.png" alt="DocChat Application View" width="100%" /> | **Document Summary**<br><img src="Screenshot 2026-07-16 at 2.29.17 PM.jpg" alt="DocChat Summary View" width="100%" /> |

### Document Conversation with Citations
Interact with documents in your native language (including Roman Urdu) with verifiable page-level citations.

<p align="center">
  <img src="Screenshot 2026-07-16 at 2.29.48 PM.jpg" alt="DocChat Full Conversation View" width="70%" />
</p>
