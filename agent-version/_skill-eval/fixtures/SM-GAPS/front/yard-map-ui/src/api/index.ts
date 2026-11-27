import axios from 'axios';
import { token } from './token';

export const yardHttp = axios.create({
  baseURL: process.env.REACT_APP_YARD_API,
  timeout: 15000,
});

yardHttp.interceptors.request.use((config) => {
  config.headers.authorization = `Bearer ${token}`;
  return config;
});
