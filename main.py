from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def home():
    return {"message": "Hello K-Talkie 👋 Yuri and JooHyuk are getting ready!"}