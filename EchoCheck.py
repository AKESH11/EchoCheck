import os
from flask import Flask, request, jsonify
import requests
from flask_cors import CORS
import json
from serpapi import GoogleSearch 
app = Flask(__name__)
CORS(app)


SERPAPI_API_KEY = os.environ.get("SERPAPI_API_KEY", "1b37108e8058700ca3287a15c6b4cbaf7af3bd67104789926ebc025de3660622")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "AIzaSyCwHGag6Gu2dlFlLWPUCuWqKSPKJKlutpY")


@app.route('/', methods=['GET'])
def index():
    return jsonify({'status': 'ok', 'message': 'EchoCheck RAG Server is running.'})

def perform_sanity_check(statement):
    lower_case_statement = statement.lower()
    impossible_claims = [
        {'keywords': ['sun', 'rises', 'west'], 'reason': 'This claim contradicts fundamental laws of astronomy.'},
        {'keywords': ['earth', 'flat'], 'reason': 'This claim contradicts centuries of established scientific evidence.'}
    ]
    for claim in impossible_claims:
        if all(kw in lower_case_statement for kw in claim['keywords']):
            return {'passed': False, 'reason': claim['reason']}
    return {'passed': True, 'reason': None}

def fetch_google_search_results(query):
    """
    Performs a real-time Google search to get the latest information.
    """
    print("\nPerforming real-time Google Search...")
    if not SERPAPI_API_KEY:
        print("--> SerpApi key not set.")
        return []
    try:
        params = {
            "q": query,
            "api_key": SERPAPI_API_KEY
        }
        search = GoogleSearch(params)
        results = search.get_dict()
        organic_results = results.get("organic_results", [])
        print(f"--> Found {len(organic_results)} search results.")
        return organic_results
    except Exception as e:
        print(f"--> FAILED to fetch Google Search results: {e}")
        return []

def get_ai_analysis(statement, search_results):
    print("\nSending statement and search results to Gemini AI...")
    if not GEMINI_API_KEY:
        return {'verdict': 'API Error', 'reasoning': 'Gemini API key is not set.', 'evidence': []}

    evidence_snippets = []
    for result in search_results[:5]:
        snippet = f"Source: {result.get('source', 'N/A')}\nTitle: {result.get('title')}\nSnippet: {result.get('snippet', 'N/A')}\n"
        evidence_snippets.append(snippet)
    
    evidence_text = "\n".join(evidence_snippets)

    prompt = f"""
    You are an AI fact-checker named EchoCheck. Your primary directive is to determine the validity of a statement based *exclusively* on the real-time search evidence provided. You MUST prioritize this evidence over your own internal knowledge.

    Statement to analyze: "{statement}"

    Real-time Search Evidence:
    ---
    {evidence_text}
    ---

    Perform the following steps:
    1.  Based *only* on the evidence provided, determine if the statement is "Confirmed", "Debunked", or "Complex/Mixed". If the evidence is insufficient or does not directly address the claim, classify it as "Inconclusive".
    2.  Write a concise, one-sentence reasoning for your verdict that directly references the provided evidence.
    3.  Generate a JSON array of the top 3 most relevant pieces of evidence from the search results. Each object must have the keys "title", "source", and "snippet".
    4.  For each of those 3 pieces of evidence, estimate its political bias as "Left-leaning", "Center", or "Right-leaning". Add this as a "bias" key.

    Respond in a single, strict JSON format with three keys: "verdict" (string), "reasoning" (string), and "evidence" (JSON array of 3 objects).
    """

    headers = {'Content-Type': 'application/json'}
    data = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json"
        }
    }

    # Try multiple models in case one has exhausted its quota
    models = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.0-flash-lite", "gemini-2.5-flash-lite"]
    result = None

    for model in models:
        gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"
        try:
            response = requests.post(gemini_url, headers=headers, json=data, timeout=30)
            if response.status_code == 429:
                print(f"--> Model {model} quota exceeded, trying next model...")
                continue
            if not response.ok:
                print(f"--> Gemini API error {response.status_code} with model {model}: {response.text[:500]}")
                continue
            result = response.json()
            print(f"--> Success with model: {model}")
            break
        except requests.exceptions.Timeout:
            print(f"--> Timeout with model {model}, trying next...")
            continue
        except Exception as e:
            print(f"--> Error with model {model}: {e}")
            continue

    if result is None:
        return {'verdict': 'API Error', 'reasoning': 'All Gemini models returned errors. Your API quota may be exhausted — check https://ai.google.dev/gemini-api/docs/rate-limits', 'evidence': []}

    try:
        content = result['candidates'][0]['content']['parts'][0]['text']
        clean_json_string = content.strip().replace('```json', '').replace('```', '')
        
        verdict_data = json.loads(clean_json_string)
        print(f"--> Gemini Verdict: {verdict_data.get('verdict')}")
        
        for i, item in enumerate(verdict_data.get('evidence', [])):
            if i < len(search_results):
                item['url'] = search_results[i].get('link', '#')

        return verdict_data

    except Exception as e:
        print(f"--> FAILED to parse Gemini response: {e}")
        return {'verdict': 'API Error', 'reasoning': 'Could not process the response from the AI model.', 'evidence': []}


@app.route('/analyze', methods=['POST'])
def analyze_claim():
    data = request.get_json()
    if not data or 'statement' not in data:
        return jsonify({'error': 'Invalid request. "statement" key is required.'}), 400

    statement = data['statement'].strip()
    print(f"\n\n--- New Request Received ---\nQuery: {statement}")

    sanity_check = perform_sanity_check(statement)
    if not sanity_check['passed']:
        print("--> Sanity check failed.")
        return jsonify({'verdict': 'Fundamentally False', 'reasoning': sanity_check['reason'], 'evidence': []})
    
    print("--> Sanity check passed. Fetching real-time search results...")
    
    search_results = fetch_google_search_results(statement)
    
    if not search_results:
        return jsonify({'verdict': 'Inconclusive', 'reasoning': 'Could not find any relevant information in a real-time search.', 'evidence': []}), 200

    result = get_ai_analysis(statement, search_results)
    
    return jsonify(result)

if __name__ == '__main__':
    app.run(debug=True, port=5000)
