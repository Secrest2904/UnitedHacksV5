import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function getRandomPoseUri(emotion: string, extensionUri: vscode.Uri): {fileUri: vscode.Uri, alt: string}{
    const emotionFolder = path.join(extensionUri.fsPath, 'media', 'default_skin', emotion);
    const fallbackFolder = path.join(extensionUri.fsPath, 'media', 'default_skin', 'attentive')

    let files: string[] = [];

    try{
        files = fs.readdirSync(emotionFolder).filter(f => f.endsWith('.png'));
    } catch (e) {
        files = []
    }

    if (files.length === 0){
        files = fs.readdirSync(fallbackFolder).filter(f => f.endsWith('.png'));
        emotion = 'attentive';
    }

    const chosen = files[Math.floor(Math.random() * files.length)];
    const fullPath = vscode.Uri.joinPath(extensionUri, 'media', 'default_skin', emotion, chosen);
    return{
        fileUri: fullPath,
        alt: `${emotion} pose`
    };
}