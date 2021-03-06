import * as debug from '../util/debug';
import {BaseRemuxer, Track} from "../remuxer/base";

let aacHeader:Uint8Array;


export abstract class AudioParser {
    readonly remuxer: BaseRemuxer;
    readonly track: Track;

    protected constructor(remuxer:BaseRemuxer) {
        this.remuxer = remuxer;
        this.track = remuxer.mp4track;
    }

    abstract setConfig():void;
}

export class AACParser extends AudioParser{

    static get samplingRateMap() {
        return [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
    }

    static get getAACHeaderData() {
        return aacHeader;
    }

    static getHeaderLength(data:Uint8Array) {
        return (data[1] & 0x01 ? 7 : 9);  // without CRC 7 and with CRC 9 Refs: https://wiki.multimedia.cx/index.php?title=ADTS
    }

    static getFrameLength(data:Uint8Array) {
        return ((data[3] & 0x03) << 11) | (data[4] << 3) | ((data[5] & 0xE0) >>> 5); // 13 bits length ref: https://wiki.multimedia.cx/index.php?title=ADTS
    }

    static isAACPattern (data:Uint8Array) {
        return data[0] === 0xff && (data[1] & 0xf0) === 0xf0 && (data[1] & 0x06) === 0x00;
    }

    static extractAAC(buffer:Uint8Array) {
        let i = 0,
          length = buffer.byteLength,
          headerLength,
          frameLength;

        const result:Uint8Array[] = [];

        if (!AACParser.isAACPattern(buffer)) {
            debug.error('Invalid ADTS audio format');
            return result;
        }
        headerLength = AACParser.getHeaderLength(buffer);
        if (!aacHeader) {
            aacHeader = buffer.subarray(0, headerLength);
        }

        while (i < length) {
            frameLength = AACParser.getFrameLength(buffer);
            result.push(buffer.subarray(headerLength, frameLength));
            buffer = buffer.slice(frameLength);
            i += frameLength;
        }
        return result;
    }



    constructor(remuxer:BaseRemuxer) {
        super(remuxer);
    }

    setConfig() {
        const config = new Uint8Array(2);
        const headerData = AACParser.getAACHeaderData;

        if (!headerData) return;

        const objectType = ((headerData[2] & 0xC0) >>> 6) + 1;
        const sampleIndex = ((headerData[2] & 0x3C) >>> 2);
        let channelCount = ((headerData[2] & 0x01) << 2);
        channelCount |= ((headerData[3] & 0xC0) >>> 6);

        /* refer to http://wiki.multimedia.cx/index.php?title=MPEG-4_Audio#Audio_Specific_Config */
        config[0] = objectType << 3;
        config[0] |= (sampleIndex & 0x0E) >> 1;
        config[1] |= (sampleIndex & 0x01) << 7;
        config[1] |= channelCount << 3;

        this.track.codec = 'mp4a.40.' + objectType;
        this.track.channelCount = channelCount;
        this.track.config = config;
        this.remuxer.readyToDecode = true;
    }
}
