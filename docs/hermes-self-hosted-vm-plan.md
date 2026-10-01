# Nuovo Hermes self-hosted — prerequisiti verificati

Richiesta utente: nuova VM separata e nuovo Hermes con bot @Testingshihab_bot, modello open-weight locale, tetto autorizzato 500 EUR/mese. Non modificare VM/prodotti esistenti. Token Telegram non ricevuto e da acquisire tramite canale sicuro, mai nel repository.

Ricognizione Azure del 2026-09-26:
- Sottoscrizione: 6220ce8e-fa6e-47a9-93a5-39b8f8d63ae5.
- Candidato: Standard_NC4as_T4_v3, swedencentral, 4 vCPU, 28 GB RAM, 1 GPU; SKU API senza restrictions (non garantisce capacità allocabile).
- Azure Retail Prices EUR: Linux non-Spot 0.4791 EUR/ora, 349.74 EUR per 730 ore. Solo compute: disco/IP/rete/imposte esclusi. Validare costo totale e mese lungo prima di acquisto; nessun hard cap di spesa garantito da Azure Budget.
- Quota 'Standard NCASv3_T4 Family': 0 vCPU, necessari almeno 4. Quota regionale 10, attualmente 2 usati.
- Identità corrente: permessi lettura/login elencati da Microsoft.Authorization/permissions; nessuna autorizzazione per creare resource group/VM/rete a livello subscription.
- Nessuna risorsa creata, nessun costo nuovo avviato.

Bloccanti: autorizzazione provisioning minima su gruppo dedicato (o creazione del gruppo da amministratore e Contributor scoped); approvazione quota GPU almeno 4 vCPU nella regione. Non richiedere Owner globale né recuperare altre credenziali per aggirare limiti.

Dopo sblocco: quotare disco/IP/rete e margine IVA, confermare totale <=500 EUR; modello open-weight quantizzato compatibile con GPU scelto solo dopo verifica licenza e test italiano/tool calling; inferenza su loopback, SSH ristretto, nessuna API modello pubblica; installazione Hermes e bot allowlist dell'utente. Non promettere assenza di rifiuti o di vincoli legali/licenza/cloud. Nessun modello finale ancora scelto.
