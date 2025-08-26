# app.py
# To run this, you'll need to install Flask and Flask-CORS:
# pip install Flask Flask-CORS google-search-results

from flask import Flask, request, jsonify
from flask_cors import CORS
import serpapi
import os

# --- Configuration ---
# IMPORTANT: Add your SerpApi API Key here.
# You can get a free key from https://serpapi.com/
SERPAPI_API_KEY = "1b37108e8058700ca3287a15c6b4cbaf7af3bd67104789926ebc025de3660622" 

# List of reputable, top-tier news sources for the search
REPUTABLE_SOURCES = [
    "apnews.com", "reuters.com", "bbc.com", "nytimes.com", 
    "wsj.com", "washingtonpost.com", "theguardian.com", "npr.org",
    "latimes.com", "usatoday.com", "forbes.com", "bloomberg.com",
    "cnbc.com", "theverge.com", "techcrunch.com"
]

# Keywords to help determine the stance of an article
CONFIRM_KEYWORDS = ["confirms", "proves", "shows", "is true", "backed by", "supported by", "verified", "endorses"]
DEBUNK_KEYWORDS = ["debunks", "false", "hoax", "myth", "untrue", "not real", "conspiracy", "misleading", "refutes", "denies", "disputes"]

# --- Flask App Setup ---
app = Flask(__name__)
CORS(app)  # This enables Cross-Origin Resource Sharing for your frontend

# --- Main Analysis Endpoint ---
@app.route('/analyze', methods=['POST'])
def analyze_statement():
    data = request.get_json()
    if not data or 'statement' not in data:
        return jsonify({"error": "Invalid request. 'statement' is required."}), 400

    statement = data['statement']
    
    # Construct a powerful search query targeting only reputable sites
    site_query = " OR ".join([f"site:{source}" for source in REPUTABLE_SOURCES])
    full_query = f'"{statement}" ({site_query})'

    try:
        # --- Search for Evidence ---
        params = {
            "engine": "google",
            "q": full_query,
            "api_key": SERPAPI_API_KEY,
            "num": 10  # Request more results for a better consensus
        }
        search = serpapi.search(params)
        
        # --- Improved Error Handling ---
        if "error" in search:
            return jsonify({
                "verdict": "API Error",
                "reasoning": f"Could not perform search. SerpApi returned an error: {search['error']}",
                "evidence": []
            }), 500

        organic_results = search.get("organic_results", [])

        if not organic_results:
            return jsonify({
                "verdict": "Inconclusive",
                "reasoning": "Could not find enough information from reputable sources to form a conclusion.",
                "evidence": []
            })

        # --- Analyze and Tally Evidence ---
        evidence_list = []
        confirm_count = 0
        debunk_count = 0

        for result in organic_results:
            title = result.get("title", "").lower()
            snippet = result.get("snippet", "").lower()
            text_content = f"{title} {snippet}"

            is_confirming = any(keyword in text_content for keyword in CONFIRM_KEYWORDS)
            is_debunking = any(keyword in text_content for keyword in DEBUNK_KEYWORDS)

            if is_confirming and not is_debunking:
                confirm_count += 1
            elif is_debunking and not is_confirming:
                debunk_count += 1
            
            evidence_list.append({
                "title": result.get("title"),
                "url": result.get("link"),
                "source": result.get("source"),
                "snippet": result.get("snippet"),
                "bias": "Center" # Placeholder, a more advanced system could determine this
            })

        # --- Smarter Verdict Logic ---
        total_evidence = len(evidence_list)
        if debunk_count > confirm_count and debunk_count >= 2:
            verdict = "Debunked"
            reasoning = f"A majority of reputable sources ({debunk_count} out of {total_evidence}) appear to refute this claim."
        elif confirm_count > debunk_count and confirm_count >= 2:
            verdict = "Confirmed"
            reasoning = f"A majority of reputable sources ({confirm_count} out of {total_evidence}) appear to support this claim."
        elif confirm_count > 0 or debunk_count > 0:
            verdict = "Complex/Mixed"
            reasoning = "Reputable sources show mixed or conflicting reports on this topic."
        else:
            verdict = "Inconclusive"
            reasoning = "While sources were found, none provided a clear confirmation or refutation of the claim."

        return jsonify({
            "verdict": verdict,
            "reasoning": reasoning,
            "evidence": evidence_list[:8] # Return up to 8 pieces of evidence
        })

    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        return jsonify({"error": "An internal server error occurred."}), 500

# --- Run the App ---
if __name__ == '__main__':
    app.run(debug=True, port=5000)
