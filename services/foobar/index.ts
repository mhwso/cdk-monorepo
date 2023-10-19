export const handler = (event: any, context: any, callback: any) => {
    console.log(event);

    callback(undefined, {
        statusCode: 200,
        body: JSON.stringify({'test': 'i am the demo service'})
    });
}
